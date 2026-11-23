package profile

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png" // registers the PNG decoder
	"io"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // registers the WebP decoder

	"tracking-service/internal/apperr"
)

const (
	// MaxUpload caps the bytes read from an upload.
	MaxUpload = 5 << 20
	// Side is the stored avatar's width and height in pixels.
	Side = 256
	// maxPixels refuses images whose decoded size would be huge: a 5 MB file
	// can expand to hundreds of MB in memory. 24 MP covers a normal phone or
	// camera photo; a 48 MP full-resolution shot has to be resized first.
	maxPixels = 24_000_000
	// maxPixelsWide is the cap for 16-bit images, which take twice the memory
	// per pixel once decoded.
	maxPixelsWide = 12_000_000
)

// decoding allows two decodes at a time, so a burst of uploads cannot add up
// to more memory than two pictures need.
var decoding = make(chan struct{}, 2)

// wide reports whether m stores 16 bits per channel.
func wide(m color.Model) bool {
	return m == color.RGBA64Model || m == color.NRGBA64Model || m == color.Gray16Model
}

func fileErr(code string) error { return apperr.Validation(map[string]string{"file": code}) }

// normalize reads an uploaded JPEG, PNG or WebP and returns it redrawn as a
// Side x Side JPEG, cropped to the centre square. Redrawing keeps only the
// pixels: EXIF (including GPS position), embedded profiles and anything else
// hidden in the file are dropped, and a file that is not really an image
// fails to decode instead of being served.
func normalize(r io.Reader) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(r, MaxUpload+1))
	if err != nil {
		return nil, fileErr("too_large")
	}
	switch {
	case len(raw) == 0:
		return nil, fileErr("required")
	case len(raw) > MaxUpload:
		return nil, fileErr("too_large")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		return nil, fileErr("unsupported_type")
	}
	limit := int64(maxPixels)
	if wide(cfg.ColorModel) {
		limit = maxPixelsWide
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > limit {
		return nil, fileErr("too_large")
	}
	decoding <- struct{}{}
	defer func() { <-decoding }()
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, fileErr("unsupported_type")
	}
	b := src.Bounds()
	side := min(b.Dx(), b.Dy())
	crop := image.Rect(0, 0, side, side).Add(image.Pt(b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2))
	dst := image.NewRGBA(image.Rect(0, 0, Side, Side))
	// A transparent PNG would turn black as JPEG: paint it on white first.
	draw.Draw(dst, dst.Bounds(), image.White, image.Point{}, draw.Src)
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, draw.Over, nil)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 85}); err != nil {
		return nil, errors.Join(errors.New("encode avatar"), err)
	}
	return out.Bytes(), nil
}
