"""approval-seal: tamper-evident, expiring, single-use approvals for agent actions."""

from .canonical import CanonicalError, canonicalize, canonical_bytes
from .seal import (
    VERSION, SealError, VerifyResult, MemoryNonceStore,
    action_hash, seal, verify, claim, new_nonce, hyperliquid_cloid,
)

__all__ = [
    "VERSION", "CanonicalError", "SealError", "VerifyResult", "MemoryNonceStore",
    "canonicalize", "canonical_bytes", "action_hash", "seal", "verify", "claim",
    "new_nonce", "hyperliquid_cloid",
]
__version__ = "0.1.0"
