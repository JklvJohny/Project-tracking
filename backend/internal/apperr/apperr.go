// Package apperr defines the stable API error codes shared by every module.
package apperr

// Error is a client-facing failure. Code is stable; Msg is English only.
type Error struct {
	Code   string
	Msg    string
	Fields map[string]string
}

func (e *Error) Error() string { return e.Msg }

func BadRequest(msg string) *Error { return &Error{Code: "bad_request", Msg: msg} }
func Unauthorized() *Error         { return &Error{Code: "unauthorized", Msg: "unauthorized"} }
func Forbidden() *Error            { return &Error{Code: "forbidden", Msg: "forbidden"} }
func NotFound(what string) *Error  { return &Error{Code: "not_found", Msg: what + " not found"} }
func Conflict(msg string) *Error   { return &Error{Code: "conflict", Msg: msg} }

func Validation(fields map[string]string) *Error {
	return &Error{Code: "validation_failed", Msg: "validation failed", Fields: fields}
}
