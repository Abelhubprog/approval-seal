"""canonical-json/1: a small, strict, deterministic JSON encoding.

Allowed values: null, true, false, integers with |n| <= 2**53 - 1, strings,
arrays, and objects with string keys. Anything else is rejected with
CanonicalError (floats, NaN, Infinity, bytes, tuples-as-keys, lone surrogates,
very deep nesting). Money amounts and prices must be strings, for example
"0.0100", never floats.

For values in that subset the output is byte-for-byte identical to
json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=True),
and the JavaScript port in js/ produces the same bytes.
"""

MAX_SAFE_INT = 2 ** 53 - 1
MAX_DEPTH = 64

_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
}


class CanonicalError(ValueError):
    """The value cannot be encoded under the canonical-json/1 rules."""


def _enc_str(s):
    """Printable ASCII (space to tilde) is literal; everything else is escaped."""
    out = ['"']
    for ch in s:
        cp = ord(ch)
        if ch in _ESCAPES:
            out.append(_ESCAPES[ch])
        elif 0x20 <= cp < 0x7F:
            out.append(ch)
        elif 0xD800 <= cp <= 0xDFFF:
            raise CanonicalError("lone surrogate in string")
        elif cp >= 0x10000:
            v = cp - 0x10000
            out.append("\\u%04x\\u%04x" % (0xD800 + (v >> 10), 0xDC00 + (v & 0x3FF)))
        else:
            out.append("\\u%04x" % cp)
    out.append('"')
    return "".join(out)


def _enc(v, depth):
    if depth > MAX_DEPTH:
        raise CanonicalError("nesting deeper than %d" % MAX_DEPTH)
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        if abs(v) > MAX_SAFE_INT:
            raise CanonicalError("integer outside +/-(2**53 - 1); use a string")
        return str(v)
    if isinstance(v, float):
        raise CanonicalError("floats are not allowed; use an integer or a decimal string")
    if isinstance(v, str):
        return _enc_str(v)
    if isinstance(v, list):
        return "[" + ",".join(_enc(x, depth + 1) for x in v) + "]"
    if isinstance(v, dict):
        for k in v:
            if not isinstance(k, str):
                raise CanonicalError("object keys must be strings")
        # str comparison in Python is by Unicode code point.
        return "{" + ",".join(
            _enc_str(k) + ":" + _enc(v[k], depth + 1) for k in sorted(v)
        ) + "}"
    raise CanonicalError("unsupported type: %s" % type(v).__name__)


def canonicalize(value):
    """Return the canonical JSON text (ASCII only) for value."""
    return _enc(value, 0)


def canonical_bytes(value):
    return canonicalize(value).encode("ascii")
