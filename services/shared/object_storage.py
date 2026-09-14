import aioboto3
from app.config import settings

_session = aioboto3.Session()


def get_s3_client():
    """Async context manager — usage: `async with get_s3_client() as s3: ...`."""
    return _session.client(
        "s3",
        endpoint_url=settings.minio_endpoint,
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
    )


async def ensure_bucket(name: str) -> None:
    async with get_s3_client() as s3:
        try:
            await s3.head_bucket(Bucket=name)
        except Exception:
            await s3.create_bucket(Bucket=name)


async def upload_bytes(key: str, data: bytes, content_type: str) -> None:
    async with get_s3_client() as s3:
        await s3.put_object(
            Bucket=settings.minio_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )


async def delete_object(key: str) -> None:
    """No-op (not an error) if the key doesn't exist — mirrors the previous
    os.remove()-wrapped-in-try/except behavior for a since-deleted local file."""
    async with get_s3_client() as s3:
        await s3.delete_object(Bucket=settings.minio_bucket, Key=key)
