package blob_test

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tracking-service/internal/blob"
)

func TestLocal_PutOpenDelete(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	bs, err := blob.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	n, err := bs.Put(ctx, "1/a.pdf", strings.NewReader("%PDF-hello"))
	if err != nil || n != 10 {
		t.Fatalf("put = %d, %v", n, err)
	}
	rc, err := bs.Open(ctx, "1/a.pdf")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(rc)
	rc.Close()
	if string(got) != "%PDF-hello" {
		t.Errorf("read back %q", got)
	}
	if err := bs.Delete(ctx, "1/a.pdf"); err != nil {
		t.Fatal(err)
	}
	if _, err := bs.Open(ctx, "1/a.pdf"); !errors.Is(err, blob.ErrNotFound) {
		t.Errorf("open after delete = %v, want ErrNotFound", err)
	}
	if err := bs.Delete(ctx, "1/a.pdf"); err != nil {
		t.Errorf("deleting twice must not fail: %v", err)
	}
}

func TestLocal_RejectsEscapingKeys(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	bs, _ := blob.NewLocal(filepath.Join(dir, "up"))
	for _, k := range []string{"../x.pdf", "1/../../x.pdf", "/abs.pdf", `..\x.pdf`, "", "a/./b.pdf", "C:/x.pdf"} {
		if _, err := bs.Put(ctx, k, strings.NewReader("x")); !errors.Is(err, blob.ErrInvalidKey) {
			t.Errorf("put %q = %v, want ErrInvalidKey", k, err)
		}
		if _, err := bs.Open(ctx, k); !errors.Is(err, blob.ErrInvalidKey) {
			t.Errorf("open %q = %v, want ErrInvalidKey", k, err)
		}
		if err := bs.Delete(ctx, k); !errors.Is(err, blob.ErrInvalidKey) {
			t.Errorf("delete %q = %v, want ErrInvalidKey", k, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "x.pdf")); err == nil {
		t.Error("a file escaped the upload dir")
	}
}

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errors.New("boom") }

func TestLocal_FailedPutLeavesNothing(t *testing.T) {
	dir := t.TempDir()
	bs, _ := blob.NewLocal(dir)
	if _, err := bs.Put(context.Background(), "1/a.pdf", io.MultiReader(strings.NewReader("%PDF-"), failingReader{})); err == nil {
		t.Fatal("want error")
	}
	if _, err := bs.Open(context.Background(), "1/a.pdf"); !errors.Is(err, blob.ErrNotFound) {
		t.Errorf("partial file kept: %v", err)
	}
	ents, _ := os.ReadDir(filepath.Join(dir, "1"))
	if len(ents) != 0 {
		t.Errorf("temp file left behind: %v", ents)
	}
}
