"""Money formatting and amount-in-words. Mirrors frontend/src/features/survey-logic/money.ts.

Both sides must give identical output for every case in shared/test-cases/money.json.
Words are generated here, never stored (docs/05-survey-builder.md, Money type).
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from num2words import num2words

Currency = Literal["INR", "USD", "EUR", "GBP", "AED"]

# Answers are stored in response_answers.value_num, numeric(14,2): 12 digits before the point.
MAX_INTEGER_DIGITS = 12
MAX_AMOUNT = Decimal("999999999999.99")
_CRORE = 10**7


@dataclass(frozen=True, slots=True)
class CurrencyInfo:
    symbol: str
    major: tuple[str, str]  # singular, plural
    minor: tuple[str, str]
    indian_grouping: bool = False
    add_only: bool = False
    space_after_symbol: bool = False


CURRENCIES: dict[Currency, CurrencyInfo] = {
    "INR": CurrencyInfo(
        "₹", ("rupee", "rupees"), ("paisa", "paise"), indian_grouping=True, add_only=True
    ),
    "USD": CurrencyInfo("$", ("dollar", "dollars"), ("cent", "cents")),
    "EUR": CurrencyInfo("€", ("euro", "euros"), ("cent", "cents")),
    "GBP": CurrencyInfo("£", ("pound", "pounds"), ("penny", "pence")),
    "AED": CurrencyInfo("AED", ("dirham", "dirhams"), ("fils", "fils"), space_after_symbol=True),
}


def _to_decimal(value: Decimal | float | int) -> Decimal:
    amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if amount < 0:
        msg = "Amounts can't be negative"
        raise ValueError(msg)
    if amount > MAX_AMOUNT:
        msg = f"Amounts can't have more than {MAX_INTEGER_DIGITS} digits before the decimal point"
        raise ValueError(msg)
    return amount


def group_digits(integer_digits: str, *, indian: bool) -> str:
    """'1234567' -> '12,34,567' (Indian) or '1,234,567' (international)."""
    if indian and len(integer_digits) > 3:  # noqa: PLR2004 - last group of three
        head, tail = integer_digits[:-3], integer_digits[-3:]
        pairs: list[str] = []
        while len(head) > 2:  # noqa: PLR2004 - Indian groups of two
            pairs.insert(0, head[-2:])
            head = head[:-2]
        if head:
            pairs.insert(0, head)
        return ",".join([*pairs, tail])
    groups: list[str] = []
    while len(integer_digits) > 3:  # noqa: PLR2004 - groups of three
        groups.insert(0, integer_digits[-3:])
        integer_digits = integer_digits[:-3]
    groups.insert(0, integer_digits)
    return ",".join(groups)


def format_amount(value: Decimal | float | int, currency: Currency) -> str:
    """₹1,25,000 · ₹12,34,567.50 · $1,234,567 · AED 1,500. Paise/cents shown only when present."""
    info = CURRENCIES[currency]
    amount = _to_decimal(value)
    integer_part, fraction = divmod(int(amount * 100), 100)
    text = group_digits(str(integer_part), indian=info.indian_grouping)
    if fraction:
        text += f".{fraction:02d}"
    return info.symbol + (" " if info.space_after_symbol else "") + text


def _clean(words: str) -> str:
    """num2words writes 'one lakh, one hundred and five'; the docs want no commas or 'and'."""
    return words.replace(",", "").replace(" and ", " ").replace("  ", " ").strip()


def _indian_words(number: int) -> str:
    # num2words' Indian mode stops below 1,000 crore, so convert the crore part separately.
    if number < _CRORE:
        return _clean(num2words(number, lang="en_IN"))
    crores, rest = divmod(number, _CRORE)
    words = f"{_indian_words(crores)} crore"
    return f"{words} {_indian_words(rest)}" if rest else words


def _international_words(number: int) -> str:
    return _clean(num2words(number, lang="en"))


def amount_in_words(value: Decimal | float | int, currency: Currency) -> str:
    """'One lakh twenty-five thousand rupees only' · 'One million dollars and five cents'."""
    info = CURRENCIES[currency]
    amount = _to_decimal(value)
    major, minor = divmod(int(amount * 100), 100)
    to_words = _indian_words if info.indian_grouping else _international_words
    text = f"{to_words(major)} {info.major[0] if major == 1 else info.major[1]}"
    if minor:
        text += f" and {to_words(minor)} {info.minor[0] if minor == 1 else info.minor[1]}"
    if info.add_only:
        text += " only"
    return text[0].upper() + text[1:]
