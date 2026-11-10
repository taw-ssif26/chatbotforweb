"""Protection that does not depend on the model behaving: refuse obvious extraction attempts before the model is called,
and watch the model's reply as it streams (hidden marker leak, long word-for-word copying of the knowledge base)."""
import re
import secrets

from .config import settings

CANARY = "cnry-" + secrets.token_hex(6)  # secret marker planted in every system prompt; it must never appear in a reply
REFUSAL = ("I can't share my instructions or internal documents, but I'm happy to help with a specific question "
           "about {name}. What would you like to know?")
LEAK_NOTICE = "I can't share that."
VERBATIM_NOTICE = "\n\n(I can't reproduce long passages word for word. Ask me a specific question and I'll answer it directly.)"

_EXTRACTION = [re.compile(p, re.IGNORECASE) for p in [
    r"\b(ignore|disregard|forget|override|bypass)\b[^.?!]{0,40}\b(previous|prior|above|earlier|all|your|the|safety)\b[^.?!]{0,30}\b(instructions?|rules|prompts?|guidelines|restrictions|programming)\b",
    r"\b(system|developer|hidden|initial|original|secret|underlying) (prompt|message|instructions?)\b",
    r"\b(reveal|show|print|repeat|output|display|leak|share|tell me|give me)\b[^.?!]{0,12}\b(your|the) (instructions|rules|prompt|configuration|guidelines)\b(?!\s+(for|to|on|about|of|when|if|in)\b)",
    r"\b(repeat|print|output|copy|paste|recite)\b[^.?!]{0,15}\b(everything|all|the text|the words|the conversation)\b[^.?!]{0,15}\b(above|before|so far|verbatim)\b",
    r"\b(dump|export|print|list|show|give|send|output|display)\b[^.?!]{0,15}\b(all|entire|whole|every|complete)\b[^.?!]{0,12}\b(knowledge( base)?|documents?|files?|database|sources?|context|training data|chunks|your data|internal data)\b",
    r"\b(your|the) (api[ _-]?keys?|secret keys?|access tokens?|bearer tokens?|admin password|credentials)\b",
    r"\bjailbreak\b|\bdeveloper mode\b|\bdo anything now\b|\bDAN mode\b",
]]


def looks_like_extraction(message: str) -> bool:
    text = " ".join(message.split())
    return any(p.search(text) for p in _EXTRACTION)


WINDOW = 40


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


class StreamGuard:
    """Feed it the model's output piece by piece. It returns the text that is safe to send now and may trip:
    'leak' (the hidden marker appeared) or 'verbatim' (a long stretch of the knowledge base was copied word for word)."""

    def __init__(self, reference: list[str], max_run: int | None = None):
        self.canary = CANARY.lower()
        self.hold = len(self.canary) + 1            # text is held back this long so a marker split across pieces is still caught
        self.max_run = max_run or settings.max_verbatim_chars
        self.shingles = {hash(n[i:i + WINDOW]) for n in map(_norm, reference) for i in range(max(len(n) - WINDOW + 1, 0))}
        self.pending = ""
        self.tail = ""
        self.norm = ""
        self.checked = 0
        self.run = 0
        self.tripped: str | None = None

    def _track(self, piece: str) -> None:
        p = re.sub(r"\s+", " ", piece.lower())
        if self.norm.endswith(" ") and p.startswith(" "):
            p = p[1:]
        self.norm += p
        for i in range(max(self.checked, WINDOW - 1), len(self.norm)):
            self.run = self.run + 1 if hash(self.norm[i - WINDOW + 1:i + 1]) in self.shingles else 0
            if self.run and self.run + WINDOW - 1 > self.max_run:
                self.tripped = self.tripped or "verbatim"
        self.checked = len(self.norm)

    def feed(self, piece: str) -> str:
        if self.tripped:
            return ""
        self.pending += piece
        if self.canary in (self.tail + self.pending).lower():
            self.tripped, self.pending = "leak", ""
            return ""
        self._track(piece)
        if self.tripped:
            self.pending = ""
            return ""
        emit = self.pending[:-self.hold] if len(self.pending) > self.hold else ""
        self.pending = self.pending[len(emit):]
        self.tail = (self.tail + emit)[-len(self.canary):]
        return emit

    def flush(self) -> str:
        out, self.pending = self.pending, ""
        if self.canary in (self.tail + out).lower():
            self.tripped = "leak"
            return ""
        return out

    def notice(self) -> str:
        return LEAK_NOTICE if self.tripped == "leak" else VERBATIM_NOTICE
