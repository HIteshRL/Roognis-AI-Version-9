from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx


AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth:3001").rstrip("/")
RAG_SERVICE_URL = os.getenv("RAG_SERVICE_URL", "http://rag:3003").rstrip("/")
# Default manifest is the local *demo* corpus (NCERT Class 8). The product
# itself is curriculum-agnostic; teachers upload any board/curriculum PDF.
MANIFEST_PATH = Path(
    os.getenv("TEXTBOOK_SEED_MANIFEST", "/app/seed-data/ncert/class-8-textbooks.json")
)
TEACHER_EMAIL = os.getenv("SEED_TEACHER_EMAIL", "teacher@demo.com")
TEACHER_PASSWORD = os.getenv("SEED_TEACHER_PASSWORD", "demo1234")
AUTO_SEED = os.getenv("AUTO_SEED_TEXTBOOKS", "true").strip().lower() == "true"


def wait_until_healthy(client: httpx.Client, base_url: str, service: str) -> None:
    last_error: Exception | None = None
    for _attempt in range(60):
        try:
            response = client.get(f"{base_url}/health", timeout=5)
            response.raise_for_status()
            return
        except (httpx.HTTPError, OSError) as exc:
            last_error = exc
            time.sleep(2)
    raise RuntimeError(f"{service} did not become healthy: {last_error}")


def load_manifest() -> tuple[dict, list[dict]]:
    if not MANIFEST_PATH.is_file():
        raise FileNotFoundError(f"Textbook seed manifest not found: {MANIFEST_PATH}")
    payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    defaults = {
        "board": payload["board"],
        "curriculum": payload["curriculum"],
        "grade": payload["grade"],
        "language": payload["language"],
    }
    chapters = payload.get("chapters")
    if not isinstance(chapters, list) or not chapters:
        raise ValueError("Textbook seed manifest must contain at least one chapter.")
    return defaults, chapters


def chapter_identity(subject: str, grade: int, chapter_number: int) -> tuple[str, int, int]:
    return subject.strip().casefold(), int(grade), int(chapter_number)


def validate_pdf(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"Seed PDF not found: {path}")
    with path.open("rb") as source:
        if source.read(5) != b"%PDF-":
            raise ValueError(f"Seed file is not a PDF: {path}")


def login_as_teacher(client: httpx.Client) -> str:
    response = client.post(
        f"{AUTH_SERVICE_URL}/api/auth/login",
        json={"email": TEACHER_EMAIL, "password": TEACHER_PASSWORD},
        timeout=15,
    )
    response.raise_for_status()
    token = response.cookies.get("jwt")
    if not token:
        raise RuntimeError("Teacher login succeeded without returning the JWT cookie.")
    return token


def ready_chapter_identities(client: httpx.Client, auth_headers: dict[str, str]) -> set[tuple[str, int, int]]:
    response = client.get(
        f"{RAG_SERVICE_URL}/api/rag/documents",
        params={"status": "ready"},
        headers=auth_headers,
        timeout=30,
    )
    response.raise_for_status()
    identities = set()
    for document in response.json().get("documents", []):
        metadata = document.get("metadata") or {}
        identities.add(
            chapter_identity(
                metadata.get("subject", ""),
                metadata.get("grade", 0),
                metadata.get("chapterNumber", 0),
            )
        )
    return identities


def upload_chapter(
    client: httpx.Client,
    auth_headers: dict[str, str],
    defaults: dict,
    chapter: dict,
) -> dict:
    pdf_path = MANIFEST_PATH.parent / chapter["file"]
    validate_pdf(pdf_path)
    metadata = {
        **defaults,
        "subject": chapter["subject"],
        "book": chapter["book"],
        "edition": chapter["edition"],
        "chapterNumber": chapter["chapterNumber"],
        "chapterName": chapter["chapterName"],
    }
    with pdf_path.open("rb") as source:
        response = client.post(
            f"{RAG_SERVICE_URL}/api/rag/upload",
            data=metadata,
            files={"file": (pdf_path.name, source, "application/pdf")},
            headers=auth_headers,
            timeout=900,
        )
    response.raise_for_status()
    return response.json()


def main() -> int:
    if not AUTO_SEED:
        print("[textbook-seed] Automatic textbook ingestion disabled.")
        return 0

    defaults, chapters = load_manifest()
    with httpx.Client(follow_redirects=True) as client:
        wait_until_healthy(client, AUTH_SERVICE_URL, "Auth service")
        wait_until_healthy(client, RAG_SERVICE_URL, "RAG service")
        jwt = login_as_teacher(client)
        auth_headers = {"Cookie": f"jwt={jwt}"}
        ready = ready_chapter_identities(client, auth_headers)

        uploaded = 0
        skipped = 0
        failures: list[str] = []
        for chapter in chapters:
            identity = chapter_identity(
                chapter["subject"], defaults["grade"], chapter["chapterNumber"]
            )
            label = f"{chapter['subject']} chapter {chapter['chapterNumber']}: {chapter['chapterName']}"
            if identity in ready:
                print(f"[textbook-seed] Skip ready {label}")
                skipped += 1
                continue
            try:
                result = upload_chapter(client, auth_headers, defaults, chapter)
                print(
                    f"[textbook-seed] Ready {label} "
                    f"({result.get('chunksCreated', 0)} chunks)"
                )
                ready.add(identity)
                uploaded += 1
            except Exception as exc:  # keep seeding independent chapters after one failure
                failures.append(f"{label}: {exc}")
                print(f"[textbook-seed] Failed {label}: {exc}", file=sys.stderr)

    print(
        f"[textbook-seed] Complete: {uploaded} uploaded, {skipped} already ready, "
        f"{len(failures)} failed."
    )
    if failures:
        print("\n".join(f"- {failure}" for failure in failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
