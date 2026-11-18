// Package blob stores uploaded files outside the database. Keys are chosen
// by the server, never derived from a client file name.
package blob

import (
	"context"
	"errors"
	"io"
)

var (
	// ErrNotFound is returned by Open for a missing key.
	ErrNotFound = errors.New("blob: not found")
	// ErrInvalidKey is returned for a key that is empty, absolute or could
	// leave the store's root.
	ErrInvalidKey = errors.New("blob: invalid key")
)

// Store is the file storage contract. The local-disk implementation is for
// development; an object store (MinIO) replaces it later.
type Store interface {
	// Put stores r under key and returns the bytes written. A failed Put
	// leaves nothing behind under key.
	Put(ctx context.Context, key string, r io.Reader) (int64, error)
	// Open returns the content, or ErrNotFound.
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	// Delete removes the content; a missing key is not an error.
	Delete(ctx context.Context, key string) error
}
