package sim

import (
	"sync"
	"time"
)

// Ticker abstracts time.Ticker so simulation actor loops can be driven by
// either real wall-clock timers or deterministic test clocks without time.Sleep.
type Ticker interface {
	C() <-chan time.Time
	Stop()
	Reset(d time.Duration)
}

// Clock creates Ticker instances for the simulation runner.
type Clock interface {
	NewTicker(d time.Duration) Ticker
	Now() time.Time
}

// RealClock wraps the standard library time package.
type RealClock struct{}

func NewRealClock() RealClock {
	return RealClock{}
}

func (RealClock) NewTicker(d time.Duration) Ticker {
	if d <= 0 {
		d = time.Millisecond
	}
	return &realTicker{t: time.NewTicker(d)}
}

func (RealClock) Now() time.Time {
	return time.Now().UTC()
}

type realTicker struct {
	t *time.Ticker
}

func (r *realTicker) C() <-chan time.Time   { return r.t.C }
func (r *realTicker) Stop()                 { r.t.Stop() }
func (r *realTicker) Reset(d time.Duration) { r.t.Reset(max(d, time.Millisecond)) }

// FakeClock is a deterministic manual clock for unit and race testing.
type FakeClock struct {
	mu      sync.Mutex
	now     time.Time
	tickers []*fakeTicker
}

func NewFakeClock(initial time.Time) *FakeClock {
	if initial.IsZero() {
		initial = time.Date(2026, 4, 5, 8, 0, 0, 0, time.UTC)
	}
	return &FakeClock{now: initial}
}

func (f *FakeClock) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.now
}

func (f *FakeClock) NewTicker(d time.Duration) Ticker {
	f.mu.Lock()
	defer f.mu.Unlock()
	ft := &fakeTicker{
		ch:  make(chan time.Time, 16),
		dur: d,
	}
	f.tickers = append(f.tickers, ft)
	return ft
}

// Tick manually fires a tick on all active fake tickers.
func (f *FakeClock) Tick(step time.Duration) {
	f.mu.Lock()
	f.now = f.now.Add(step)
	now := f.now
	tickers := append([]*fakeTicker(nil), f.tickers...)
	f.mu.Unlock()

	for _, ft := range tickers {
		ft.fire(now)
	}
}

type fakeTicker struct {
	mu      sync.Mutex
	ch      chan time.Time
	dur     time.Duration
	stopped bool
}

func (ft *fakeTicker) C() <-chan time.Time { return ft.ch }

func (ft *fakeTicker) Stop() {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	ft.stopped = true
}

func (ft *fakeTicker) Reset(d time.Duration) {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	ft.dur = d
	ft.stopped = false
}

func (ft *fakeTicker) fire(t time.Time) {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	if ft.stopped {
		return
	}
	select {
	case ft.ch <- t:
	default:
	}
}
