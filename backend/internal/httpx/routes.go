package httpx

import (
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
)

// Routes lists every registered route as "METHOD /full/path", sorted. A
// subrouter's own "/" is reported without the trailing slash, so
// "/projects/{projectID}/" reads "/projects/{projectID}". It exists so a test
// can hold the OpenAPI contract and the router to each other.
func Routes(h http.Handler) []string {
	var out []string
	r, ok := h.(chi.Routes)
	if !ok {
		return nil
	}
	_ = chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if len(route) > 1 {
			route = strings.TrimSuffix(route, "/")
		}
		out = append(out, method+" "+route)
		return nil
	})
	sort.Strings(out)
	return out
}

// BasePath is the API prefix every module route sits under.
const BasePath = basePath
