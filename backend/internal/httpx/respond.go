// Package httpx holds the response envelope, request decoding and router.
package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"tracking-service/internal/apperr"
)

const maxBody = 1 << 20 // 1 MiB

var statusByCode = map[string]int{
	"bad_request":       http.StatusBadRequest,
	"unauthorized":      http.StatusUnauthorized,
	"forbidden":         http.StatusForbidden,
	"not_found":         http.StatusNotFound,
	"conflict":          http.StatusConflict,
	"validation_failed": http.StatusUnprocessableEntity,
	"server_error":      http.StatusInternalServerError,
}

// Structs, not maps, so the key order is stable: success first.
type okBody struct {
	Success bool `json:"success"`
	Data    any  `json:"data"`
}

type failBody struct {
	Success bool              `json:"success"`
	Error   string            `json:"error"`
	Code    string            `json:"code"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func write(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("encode response", "err", err)
	}
}

// OK writes the success envelope.
func OK(w http.ResponseWriter, status int, data any) {
	write(w, status, okBody{Success: true, Data: data})
}

// Fail writes the failure envelope. Unknown errors become a generic 500 so
// internal details never reach the client.
func Fail(w http.ResponseWriter, r *http.Request, err error) {
	var ae *apperr.Error
	if !errors.As(err, &ae) {
		slog.Error("unhandled error", "err", err, "method", r.Method, "path", r.URL.Path)
		ae = &apperr.Error{Code: "server_error", Msg: "internal error"}
	}
	status, ok := statusByCode[ae.Code]
	if !ok {
		status = http.StatusInternalServerError
	}
	write(w, status, failBody{Error: ae.Msg, Code: ae.Code, Fields: ae.Fields})
}

// Decode reads one JSON object, rejecting unknown fields and oversized bodies.
func Decode(r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return apperr.BadRequest("invalid request body")
	}
	return nil
}
