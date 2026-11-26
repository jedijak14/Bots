"""Fetch Google's Gemma 2 2B IT Flax checkpoint using the official Kaggle API.

This performs a real, potentially multi-gigabyte network download. You must
obtain access and accept applicable model terms through Kaggle beforehand.
The download uses Kaggle's own local cache, not the Bots repository.
"""
import json
from pathlib import Path
import sys

HANDLE = "google/gemma-2/flax/gemma2-2b-it"


def resolve_checkpoint(root: Path) -> tuple[Path, Path]:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError("The downloaded model directory does not exist.")
    tokenizers = [p for p in root.rglob("tokenizer.model") if p.is_file()]
    if len(tokenizers) != 1:
        raise ValueError("Expected exactly one tokenizer.model in the downloaded model.")
    # Google's Gemma checkpoint docs specify a `2b/` checkpoint directory
    # alongside tokenizer.model. Do not guess or silently accept GGUF files.
    checkpoint = tokenizers[0].parent / "2b"
    if not checkpoint.is_dir() or not any(checkpoint.iterdir()):
        raise ValueError("Expected a nonempty 2b/ Flax checkpoint directory beside tokenizer.model.")
    return checkpoint, tokenizers[0]


def main() -> int:
    try:
        import kagglehub
    except ImportError:
        print("Install kagglehub in your training environment before fetching weights.", file=sys.stderr)
        return 2
    print(f"Requesting {HANDLE} from Kaggle; this may download several GB.", file=sys.stderr, flush=True)
    try:
        root = Path(kagglehub.model_download(HANDLE))
        checkpoint, tokenizer = resolve_checkpoint(root)
    except Exception as error:
        # Do not print SDK exceptions: they can contain private signed URLs.
        print(f"Checkpoint download or validation failed ({type(error).__name__}). Check network access, Kaggle authentication, model access and accepted terms.", file=sys.stderr)
        return 1
    print(json.dumps({"handle": HANDLE, "checkpoint": str(checkpoint), "tokenizer": str(tokenizer)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
