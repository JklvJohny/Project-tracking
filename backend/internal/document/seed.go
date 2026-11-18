package document

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"tracking-service/internal/apperr"
)

// SeedFromDir imports root/<folder>/*.pdf into the project each folder maps
// to, as uploader. A missing root or folder is skipped silently and a file
// that is not a valid PDF is skipped. It returns how many files were imported.
func SeedFromDir(ctx context.Context, s *Service, root string, folders map[string]int64, uploader int64) (int, error) {
	names := make([]string, 0, len(folders))
	for f := range folders {
		names = append(names, f)
	}
	sort.Strings(names)
	n := 0
	for _, folder := range names {
		entries, err := os.ReadDir(filepath.Join(root, folder))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return n, err
		}
		for _, e := range entries {
			if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".pdf") {
				continue
			}
			f, err := os.Open(filepath.Join(root, folder, e.Name()))
			if err != nil {
				return n, err
			}
			_, err = s.Upload(ctx, uploader, folders[folder], e.Name(), f)
			_ = f.Close()
			var ae *apperr.Error
			if errors.As(err, &ae) && ae.Code == "validation_failed" {
				continue
			}
			if err != nil {
				return n, err
			}
			n++
		}
	}
	return n, nil
}
