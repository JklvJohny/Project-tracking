// Package apperr defines the stable API error codes shared by every module.
package apperr

import "errors"

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

// NotFoundAs turns any not_found into not_found for what. Child resolvers use
// it so a non-member gets the same message for an existing child as for a
// missing one: the message must not reveal that the child exists.
func NotFoundAs(err error, what string) error {
	var ae *Error
	if errors.As(err, &ae) && ae.Code == "not_found" {
		return NotFound(what)
	}
	return err
}

// ConflictProjectArchived is the conflict token for any write rejected because
// the project is archived: an archived project is read-only until restored.
const ConflictProjectArchived = "project_archived"

func ProjectArchived() *Error { return Conflict(ConflictProjectArchived) }

func Validation(fields map[string]string) *Error {
	return &Error{Code: "validation_failed", Msg: "validation failed", Fields: fields}
}
