package board

import (
	"errors"

	"tracking-service/internal/apperr"
	"tracking-service/internal/rank"
	"tracking-service/internal/store"
)

// MoveInput names the visible neighbours of a drop spot. The client sends
// what it saw, which may be older than the server's state, so the server
// re-checks them (see Place).
type MoveInput struct {
	BeforeID *int64 `json:"beforeId"`
	AfterID  *int64 `json:"afterId"`
}

// Placement is the result of Place. Rebalanced is nil unless the siblings had
// to be re-spread; then it holds the new position of every sibling except the
// moving one, and Position was computed against those new keys. The caller
// writes Rebalanced first, then the moving item's Position.
type Placement struct {
	Position   string
	Rebalanced []store.IDPos
}

func staleOrder() error { return apperr.Conflict("stale_order") }

// Place picks a LexoRank key for an item dropped between two neighbours. It is
// pure and not list-specific: lists, cards and checklist items all use it.
//
// sibs are the positions of every sibling in the container (archived ones
// included, so keys never collide), ascending, as read under a lock the caller
// already holds. movingID is ignored among the siblings (0 for a new item).
// A neighbour that is missing from sibs, or neighbours that are not ordered
// before < after, answer conflict "stale_order" and nothing is computed.
// With one neighbour the item lands right next to it; with none it goes to
// the end. When no key fits between the neighbours, the siblings are re-spread
// with rank.Spread and the key is computed once more.
func Place(sibs []store.IDPos, movingID int64, in MoveInput) (Placement, error) {
	others := make([]store.IDPos, 0, len(sibs))
	for _, s := range sibs {
		if s.ID != movingID {
			others = append(others, s)
		}
	}
	find := func(id int64) int {
		for i, s := range others {
			if s.ID == id {
				return i
			}
		}
		return -1
	}
	bi, ai := len(others)-1, len(others) // default: append at the end
	if in.BeforeID != nil {
		if bi = find(*in.BeforeID); bi < 0 {
			return Placement{}, staleOrder()
		}
		ai = bi + 1
	}
	if in.AfterID != nil {
		i := find(*in.AfterID)
		if i < 0 || (in.BeforeID != nil && i <= bi) {
			return Placement{}, staleOrder()
		}
		ai = i
		if in.BeforeID == nil {
			bi = i - 1
		}
	}

	between := func(ps []store.IDPos) (string, error) {
		lo, hi := "", ""
		if bi >= 0 {
			lo = ps[bi].Position
		}
		if ai < len(ps) {
			hi = ps[ai].Position
		}
		return rank.Between(lo, hi)
	}
	pos, err := between(others)
	if err == nil {
		return Placement{Position: pos}, nil
	}
	if !errors.Is(err, rank.ErrNoGap) {
		return Placement{}, err
	}
	keys := rank.Spread(len(others))
	spread := make([]store.IDPos, len(others))
	for i, s := range others {
		spread[i] = store.IDPos{ID: s.ID, Position: keys[i]}
	}
	if pos, err = between(spread); err != nil {
		return Placement{}, err
	}
	return Placement{Position: pos, Rebalanced: spread}, nil
}
