-- 001_init.sql: Hybrid JSONB + Typed Relational Schema for Hydro NFT Digital Twin

CREATE TABLE IF NOT EXISTS farms (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL,
    schema_version  TEXT NOT NULL DEFAULT '1.0',
    spec            JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS simulations (
    id               UUID PRIMARY KEY,
    farm_id          UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    seed             BIGINT NOT NULL,
    step_seconds     INTEGER NOT NULL DEFAULT 300,
    mode             TEXT NOT NULL CHECK (mode IN ('paused', 'running')),
    speed_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    tick_index       BIGINT NOT NULL DEFAULT 0,
    sim_time_sec     DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    active_faults    JSONB NOT NULL DEFAULT '[]'::jsonb,
    dropped_batches  BIGINT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensor_readings (
    simulation_id    UUID NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
    tick_index       BIGINT NOT NULL,
    sim_time_sec     DOUBLE PRECISION NOT NULL,
    sensor_id        TEXT NOT NULL,
    component_id     TEXT NOT NULL,
    kind             TEXT NOT NULL,
    value            DOUBLE PRECISION NULL,
    unit             TEXT NOT NULL,
    PRIMARY KEY (simulation_id, tick_index, sensor_id)
);

CREATE INDEX IF NOT EXISTS idx_readings_sim_time ON sensor_readings (simulation_id, sim_time_sec DESC);
CREATE INDEX IF NOT EXISTS idx_readings_sim_comp ON sensor_readings (simulation_id, component_id, sim_time_sec DESC);

CREATE TABLE IF NOT EXISTS alerts (
    id               UUID PRIMARY KEY,
    simulation_id    UUID NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
    sim_time_sec     DOUBLE PRECISION NOT NULL,
    component_id     TEXT NOT NULL,
    severity         TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    code             TEXT NOT NULL,
    message          TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_sim_created ON alerts (simulation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS commands (
    id                  UUID PRIMARY KEY,
    simulation_id       UUID NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
    sim_time_sec        DOUBLE PRECISION NOT NULL,
    target_component_id TEXT NOT NULL,
    action              TEXT NOT NULL,
    payload             JSONB NOT NULL,
    reason              TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('accepted', 'rejected_safety')),
    rejection_code      TEXT NULL,
    rejection_message   TEXT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commands_sim_created ON commands (simulation_id, created_at DESC);
