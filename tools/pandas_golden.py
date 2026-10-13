"""pandas_golden.py — freeze real pandas output as a golden file for parity tests.

Why a golden file instead of calling pandas from the test:

    CI runs on a bare Node runner with no Python and no pandas. If the parity
    check needed pandas at test time it could never run in CI, which is exactly
    where a regression needs to be caught. So the expensive, environment-bound
    half runs here (occasionally, by hand) and the cheap half — comparing our
    engine against the frozen numbers — runs on every push.

Usage:

    python tools/pandas_golden.py                 # all bundled datasets
    python tools/pandas_golden.py iris tips       # a subset

Output: tools/golden/<dataset>.json

Every value written here is what pandas/numpy actually produced on the machine
that ran this script; nothing is hand-written or rounded by hand. Floats are
rounded to 10 decimals purely to keep the file readable and small — the
comparison tolerance in tools/parity-test.mjs is looser than that rounding.
"""

import json
import os
import sys

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "tools", "golden")

# whole-file reads: these are the datasets the app bundles, so the app's own
# sample loader and this script must agree column-for-column
DATASETS = [
    "sales", "iris", "tips", "titanic", "penguins",
    "flights", "mpg", "gapminder", "taxis", "diamonds",
]

ROUND = 10

# Size guards. All three exist because the taxis dataset's first "categorical"
# column is a near-unique timestamp: uncapped, `value_counts` alone produced a
# 290 MB golden file, and the groupby maps were not far behind.
VALUE_COUNT_CAP = 50
CROSSTAB_CAP = 400
GROUP_CAP = 60


def pick_low_cardinality(df, cats, k, cap=GROUP_CAP):
    """The first `k` categorical columns whose distinct count stays manageable.

    A parity test is only interesting if a human can read the expected values.
    Grouping taxis by a timestamp gives one group per row — technically correct
    and completely useless as a regression fixture.
    """
    picked = [c for c in cats if df[c].nunique(dropna=True) <= cap]
    return picked[:k]


def r(x):
    """Round for storage. NaN/None survive as null so JSON stays valid."""
    if x is None:
        return None
    if isinstance(x, (np.floating, float)):
        if np.isnan(x):
            return None
        return round(float(x), ROUND)
    if isinstance(x, (np.integer, int)):
        return int(x)
    return x


def series_of(vals):
    return [r(v) for v in vals]


def numeric_columns(df):
    """Numeric, in our engine's sense.

    `is_numeric_dtype` is True for bool in pandas, but our DataFrame models
    boolean as its own dtype — and `describe()` on a bool column returns
    count/unique/top/freq rather than the eight numbers. Excluding bools here
    keeps the two type systems aligned.
    """
    return [c for c in df.columns
            if pd.api.types.is_numeric_dtype(df[c])
            and not pd.api.types.is_bool_dtype(df[c])]


def categorical_columns(df):
    return [c for c in df.columns if c not in numeric_columns(df)]


def dtype_name(s):
    """Map a pandas dtype onto the four dtypes our engine actually models."""
    if pd.api.types.is_bool_dtype(s):
        return "boolean"
    if pd.api.types.is_numeric_dtype(s):
        return "number"
    if pd.api.types.is_datetime64_any_dtype(s):
        return "date"
    return "string"


def build(name):
    path = os.path.join(DATA, name + ".csv")
    df = pd.read_csv(path)

    nums = numeric_columns(df)
    cats = categorical_columns(df)

    out = {
        "dataset": name,
        "pandas": pd.__version__,
        "numpy": np.__version__,
        "shape": [int(df.shape[0]), int(df.shape[1])],
        "columns": [str(c) for c in df.columns],
        "dtypes": {str(c): dtype_name(df[c]) for c in df.columns},
        "numericColumns": [str(c) for c in nums],
        # isna().sum() — the number the Statistics tab shows
        "missing": {str(c): int(df[c].isna().sum()) for c in df.columns},
        "nunique": {str(c): int(df[c].nunique(dropna=True)) for c in df.columns},
    }

    # ---- describe(): the eight numbers our describe() reproduces -------------
    if nums:
        desc = df[nums].describe()
        out["describe"] = {
            str(c): {
                "count": r(desc.loc["count", c]),
                "mean": r(desc.loc["mean", c]),
                "std": r(desc.loc["std", c]),
                "min": r(desc.loc["min", c]),
                "q25": r(desc.loc["25%", c]),
                "q50": r(desc.loc["50%", c]),
                "q75": r(desc.loc["75%", c]),
                "max": r(desc.loc["max", c]),
            }
            for c in nums
        }
        # quantile() at points describe() does not cover — this is what pins the
        # interpolation rule, since no standard summary uses 0.1 or 0.9
        out["quantiles"] = {
            str(c): {
                "0.1": r(df[c].quantile(0.1)),
                "0.9": r(df[c].quantile(0.9)),
                "0.333": r(df[c].quantile(0.333)),
            }
            for c in nums
        }
        # corr(): pandas uses pairwise-complete observations by default
        if len(nums) > 1:
            cm = df[nums].corr()
            out["corr"] = {
                "columns": [str(c) for c in nums],
                "matrix": [[r(v) for v in row] for row in cm.to_numpy()],
            }

    # ---- value_counts: a map, not a list — tie order is not part of the API --
    # Capped: a near-unique column (a timestamp, an id) would otherwise write
    # one entry per row and turn a 5 KB file into hundreds of megabytes. The
    # full distinct count is carried alongside, so nothing is lost.
    if cats:
        vc = {}
        for c in pick_low_cardinality(df, cats, 4):
            counts = df[c].value_counts(dropna=True)
            head = counts.head(VALUE_COUNT_CAP)
            vc[str(c)] = {
                "distinct": int(counts.shape[0]),
                "truncated": bool(counts.shape[0] > VALUE_COUNT_CAP),
                "top": {str(k): int(v) for k, v in head.items()},
            }
        out["valueCounts"] = vc

    # ---- groupby: a low-cardinality categorical x the first numeric ----------
    group_cats = pick_low_cardinality(df, cats, 1)
    if group_cats and nums:
        g, v = str(group_cats[0]), str(nums[0])
        grouped = df.groupby(g, dropna=True)[v]
        out["groupby"] = {
            "by": g,
            "value": v,
            "count": {str(k): int(x) for k, x in grouped.count().items()},
            "sum": {str(k): r(x) for k, x in grouped.sum().items()},
            "mean": {str(k): r(x) for k, x in grouped.mean().items()},
            "median": {str(k): r(x) for k, x in grouped.median().items()},
            "min": {str(k): r(x) for k, x in grouped.min().items()},
            "max": {str(k): r(x) for k, x in grouped.max().items()},
        }

    # ---- crosstab of two low-cardinality categorical columns -----------------
    # Two high-cardinality columns are a Cartesian product; freezing a
    # 6,000 x 6,000 grid would be absurd, and unreadable besides.
    ct_cats = pick_low_cardinality(df, cats, 2)
    if len(ct_cats) >= 2:
        a, b = str(ct_cats[0]), str(ct_cats[1])
        if df[a].nunique(dropna=True) * df[b].nunique(dropna=True) <= CROSSTAB_CAP:
            ct = pd.crosstab(df[a], df[b])
            out["crosstab"] = {
                "rows": [str(i) for i in ct.index],
                "cols": [str(c) for c in ct.columns],
                "grid": [[int(v) for v in row] for row in ct.to_numpy()],
            }

    # ---- sort_values: the head and tail, which a stable sort makes unique ----
    if nums:
        c = str(nums[0])
        s = df.sort_values(c, ascending=False, kind="mergesort")[c]
        out["sortDescFirst5"] = series_of(s.head(5))
        out["sortDescLast5"] = series_of(s.tail(5))

    return out


def main():
    args = sys.argv[1:] or DATASETS
    os.makedirs(OUT, exist_ok=True)
    print(f"pandas {pd.__version__} / numpy {np.__version__}")
    for name in args:
        path = os.path.join(DATA, name + ".csv")
        if not os.path.exists(path):
            print(f"  ! {name}: {path} not found")
            continue
        blob = build(name)
        dest = os.path.join(OUT, name + ".json")
        with open(dest, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(blob, fh, ensure_ascii=False, indent=1, sort_keys=True)
            fh.write("\n")
        size = os.path.getsize(dest)
        print(f"  ✓ {name:10s} {blob['shape'][0]:>6d} x {blob['shape'][1]:<3d} -> {size:>8,} B")


if __name__ == "__main__":
    main()
