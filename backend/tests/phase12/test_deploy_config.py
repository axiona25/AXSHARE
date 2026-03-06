"""Verifica configurazione deploy: .env.prod.example, .gitignore, Dockerfile, compose."""

import os
import pytest


def _root_path(*rel):
    base = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(base, "..", "..", "..", *rel))


def test_env_example_has_all_required_vars():
    """Verifica che .env.prod.example contenga tutte le variabili necessarie."""
    env_example_path = _root_path(".env.prod.example")
    if not os.path.exists(env_example_path):
        pytest.skip(".env.prod.example non trovato")
    with open(env_example_path) as f:
        content = f.read()
    required_vars = [
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "REDIS_PASSWORD",
        "SECRET_KEY",
        "DOMAIN",
        "MINIO_ROOT_USER",
    ]
    for var in required_vars:
        assert var in content, f"Variabile mancante in .env.prod.example: {var}"


def test_gitignore_excludes_secrets():
    """Verifica che .gitignore escluda i file sensibili."""
    gitignore_path = _root_path(".gitignore")
    if not os.path.exists(gitignore_path):
        pytest.skip(".gitignore non trovato")
    with open(gitignore_path) as f:
        content = f.read()
    sensitive_patterns = [".env.prod", "*.pem", "*.key"]
    for pattern in sensitive_patterns:
        assert pattern in content, f"Pattern mancante in .gitignore: {pattern}"


def test_dockerfile_uses_nonroot_user():
    """Dockerfile.prod usa utente non-root."""
    dockerfile_path = _root_path("backend", "Dockerfile.prod")
    if not os.path.exists(dockerfile_path):
        pytest.skip("Dockerfile.prod non trovato")
    with open(dockerfile_path) as f:
        content = f.read()
    assert "USER axshare" in content or "USER nobody" in content, (
        "Dockerfile.prod deve usare un utente non-root"
    )


def test_docker_compose_has_healthchecks():
    """docker-compose.prod.yml ha healthcheck per i servizi critici."""
    import yaml

    compose_path = _root_path("docker-compose.prod.yml")
    if not os.path.exists(compose_path):
        pytest.skip("docker-compose.prod.yml non trovato")
    with open(compose_path) as f:
        config = yaml.safe_load(f)
    critical = ["backend", "postgres", "redis"]
    for svc in critical:
        assert "healthcheck" in config.get("services", {}).get(svc, {}), (
            f"Healthcheck mancante per servizio: {svc}"
        )
