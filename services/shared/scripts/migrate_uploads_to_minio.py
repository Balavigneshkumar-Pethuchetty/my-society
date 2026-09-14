"""One-off, manually-invoked migration: uploads every file under a local uploads
directory to MinIO, keyed by <prefix>/<filename> (the same relative path already
stored in the DB, e.g. avatar_url/screenshot_path/file_path columns) — so no DB
rows need to change. Idempotent (skips a key that already exists in the bucket),
safe to re-run.

Usage (run from inside a service container that already has the volume mounted
and MinIO env vars configured, e.g.):
    docker compose run --rm user-service python -m shared.scripts.migrate_uploads_to_minio \\
        --dir /app/uploads/avatars --prefix avatars
"""
import argparse
import asyncio
import mimetypes
import os

from app.config import settings
from shared.object_storage import ensure_bucket, get_s3_client


async def _already_uploaded(s3, bucket: str, key: str) -> bool:
    try:
        await s3.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


async def migrate(local_dir: str, prefix: str) -> None:
    await ensure_bucket(settings.minio_bucket)

    if not os.path.isdir(local_dir):
        print(f"Directory does not exist, nothing to migrate: {local_dir}")
        return

    filenames = sorted(os.listdir(local_dir))
    uploaded = 0
    skipped = 0

    async with get_s3_client() as s3:
        for name in filenames:
            path = os.path.join(local_dir, name)
            if not os.path.isfile(path):
                continue
            key = f"{prefix}/{name}"
            if await _already_uploaded(s3, settings.minio_bucket, key):
                skipped += 1
                continue
            with open(path, "rb") as f:
                data = f.read()
            content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
            await s3.put_object(Bucket=settings.minio_bucket, Key=key, Body=data, ContentType=content_type)
            uploaded += 1

    print(f"Migration complete for {local_dir} -> {settings.minio_bucket}/{prefix}/: "
          f"{uploaded} uploaded, {skipped} already present, {len(filenames)} total files seen.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True, help="Local directory to migrate, e.g. /app/uploads/avatars")
    parser.add_argument("--prefix", required=True, help="MinIO key prefix, e.g. avatars")
    args = parser.parse_args()
    asyncio.run(migrate(args.dir, args.prefix))
