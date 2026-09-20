"""Data models for notification service."""
from datetime import datetime
from typing import Any, Dict, Optional
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field


class NotificationSource(str, Enum):
    """Notification delivery source."""
    NOVU = "novu"
    LEGACY_EMAIL = "legacy_email"
    LEGACY_SMS = "legacy_sms"
    LEGACY_TELEGRAM = "legacy_telegram"
    NONE = "none"


class NotificationStatus(str, Enum):
    """Notification delivery status."""
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    BOUNCED = "bounced"


class NotificationChannel(str, Enum):
    """Notification channels."""
    EMAIL = "email"
    SMS = "sms"
    TELEGRAM = "telegram"
    IN_APP = "in_app"


class SendNotificationRequest(BaseModel):
    """Request to send a unified notification."""
    user_id: str = Field(..., description="User UUID")
    event_name: str = Field(..., description="Novu event/template name")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Template payload")
    user_phone: Optional[str] = Field(None, description="Phone number for SMS/Telegram")
    user_email: Optional[str] = Field(None, description="Email for email notifications")
    legacy_message: Optional[str] = Field(None, description="Fallback message for legacy channels")
    notify_sms: bool = Field(True, description="Send SMS notification")
    notify_email: bool = Field(True, description="Send email notification")
    notify_telegram: bool = Field(True, description="Send Telegram notification")
    tags: Optional[list] = Field(None, description="Tags for tracking")


class SendNotificationResponse(BaseModel):
    """Response from send notification endpoint."""
    source: NotificationSource
    success: bool
    id: Optional[str] = None
    message: Optional[str] = None
    data: Dict[str, Any] = Field(default_factory=dict)


class InAppNotificationRequest(BaseModel):
    """Request to record in-app notification."""
    user_id: str = Field(..., description="User UUID")
    type_: str = Field(..., alias="type", description="Notification type")
    title: str = Field(..., description="Notification title")
    message: str = Field(..., description="Notification message")
    related_id: Optional[str] = Field(None, description="Related resource ID (e.g., event_id)")
    event_id: Optional[str] = Field(None, description="Associated event ID")


class InAppNotificationResponse(BaseModel):
    """Response from in-app notification endpoint."""
    id: str
    user_id: str
    type_: str = Field(alias="type")
    title: str
    message: str
    created_at: datetime
    read_at: Optional[datetime] = None


class NotificationLog(BaseModel):
    """Notification delivery log entry."""
    id: UUID
    user_id: str
    event_name: str
    source: NotificationSource
    status: NotificationStatus
    channels_sent: list[NotificationChannel] = Field(default_factory=list)
    payload: Dict[str, Any]
    error_message: Optional[str] = None
    delivery_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BulkNotificationRequest(BaseModel):
    """Request to send notifications to multiple users."""
    user_ids: list[str] = Field(..., description="List of user UUIDs")
    event_name: str = Field(..., description="Novu event/template name")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Template payload")
    legacy_message: Optional[str] = Field(None, description="Fallback message")
    notify_sms: bool = Field(True)
    notify_email: bool = Field(True)
    notify_telegram: bool = Field(True)


class BulkNotificationResponse(BaseModel):
    """Response from bulk notification endpoint."""
    total: int
    successful: int
    failed: int
    results: list[SendNotificationResponse]
