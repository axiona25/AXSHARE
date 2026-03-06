//! Stub per disco virtuale su Windows (WinFsp — TASK 7.4).

/// Montaggio non implementato: richiede WinFsp.
pub async fn mount() -> Result<(), String> {
    Err("Disco virtuale non disponibile su Windows. Installare WinFsp per abilitarlo.".to_string())
}

/// Smontaggio: no-op se non montato.
pub async fn unmount() -> Result<(), String> {
    Ok(())
}
