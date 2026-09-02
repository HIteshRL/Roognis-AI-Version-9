"""Fire-and-forget outbound calls to sibling services.

Analytics events are emitted on a daemon thread so a slow or unavailable
Analytics Service never blocks or fails a teacher/student request — the same
non-blocking contract the Node services use for `fireAnalyticsEvent`.
"""
import json
import logging
import threading
from urllib import request as urlrequest
from urllib.error import URLError

from config import Settings

logger = logging.getLogger(__name__)


def fire_analytics_event(settings: Settings, event: dict) -> None:
    if not settings.analytics_url or not settings.internal_service_token:
        return

    endpoint = f"{settings.analytics_url.rstrip('/')}/api/analytics/event"
    token = settings.internal_service_token

    def _send() -> None:
        try:
            body = json.dumps(event).encode("utf-8")
            req = urlrequest.Request(
                endpoint,
                data=body,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "X-Internal-Service-Token": token,
                },
            )
            with urlrequest.urlopen(req, timeout=3) as response:
                if response.status >= 300:
                    logger.warning("analytics event returned status %s", response.status)
        except (OSError, URLError, ValueError) as exc:
            logger.warning("analytics event failed: %s", exc)

    threading.Thread(target=_send, daemon=True).start()
