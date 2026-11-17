package store

// Priority is stored as int16 0-3; the API only ever shows the name.
var priorityNames = [...]string{"low", "medium", "high", "urgent"}

// PriorityName maps 0-3 to its API name; out-of-range values read as "low".
func PriorityName(p int16) string {
	if p < 0 || int(p) >= len(priorityNames) {
		return priorityNames[0]
	}
	return priorityNames[p]
}

// ParsePriority maps an API name to 0-3; ok is false for anything else.
func ParsePriority(s string) (p int16, ok bool) {
	for i, n := range priorityNames {
		if n == s {
			return int16(i), true
		}
	}
	return 0, false
}
