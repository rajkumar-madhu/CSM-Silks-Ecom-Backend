import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "csm_backend.settings")

app = Celery("csm_backend")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# Task configuration for production
app.conf.task_serializer = "json"
app.conf.result_serializer = "json"
app.conf.accept_content = ["json"]
app.conf.result_expires = 3600  # 1 hour
app.conf.task_track_started = True
app.conf.task_time_limit = 30 * 60  # 30 minutes hard limit
app.conf.task_soft_time_limit = 25 * 60  # 25 minutes soft limit
app.conf.worker_prefetch_multiplier = 1
app.conf.worker_max_tasks_per_child = 1000

# Retry configuration
app.conf.task_default_retry_delay = 60  # 1 minute
app.conf.task_max_retries = 3
app.conf.task_acks_late = True

app.conf.beat_schedule = {
    "release-expired-stock-reservations": {
        "task": "inventory.release_expired_stock_reservations",
        "schedule": crontab(minute="*/5"),  # every 5 minutes
        "options": {"expires": 300},  # Task expires after 5 minutes
    },
    # Customer try-on photos are personal data written by an AllowAny endpoint into
    # publicly-served media — they must not be retained indefinitely.
    "purge-expired-tryon-photos": {
        "task": "ai.purge_expired_tryon_photos",
        "schedule": crontab(minute=30, hour=3),  # nightly at 03:30
        "options": {"expires": 3600},
    },
    # The stock-alert waitlist promises a WhatsApp/SMS on restock; poll so every route
    # back into stock (cancel, return, admin adjustment) triggers it.
    "notify-restocked-watchers": {
        "task": "catalog.notify_restocked_watchers",
        "schedule": crontab(minute="*/10"),
        "options": {"expires": 600},
    },
}
