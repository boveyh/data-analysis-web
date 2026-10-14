"""Generate a reproducible synthetic retail-sales dataset (data/sales.csv).

Synthetic on purpose: no licensing concerns, and the generator is checked in so
anyone can reproduce or re-roll the sample.  Run:  python tools/generate_sales.py
"""
import csv
import random
from datetime import date, timedelta
from pathlib import Path

random.seed(20241010)

REGIONS = {
    "East": ["Shanghai", "Hangzhou", "Nanjing"],
    "North": ["Beijing", "Tianjin", "Jinan"],
    "South": ["Guangzhou", "Shenzhen", "Xiamen"],
    "West": ["Chengdu", "Chongqing", "Xi'an"],
    "Central": ["Wuhan", "Changsha", "Zhengzhou"],
}
CATEGORIES = {
    "Electronics": [("Laptop Pro 14", 6200), ("Noise-Cancel Headset", 890), ("Smart Watch S9", 1450), ("4K Monitor 27", 2100)],
    "Apparel":     [("Down Jacket", 460), ("Running Shoes", 320), ("Wool Sweater", 260), ("Denim Jacket", 390)],
    "Home":        [("Air Purifier", 1180), ("Robot Vacuum", 2350), ("Coffee Machine", 780), ("Desk Lamp", 160)],
    "Grocery":     [("Organic Coffee Bean", 128), ("Olive Oil 1L", 96), ("Almond Nuts 500g", 68), ("Green Tea Gift", 210)],
    "Sports":      [("Yoga Mat", 145), ("Dumbbell Set 20kg", 420), ("Cycling Helmet", 290), ("Camping Tent", 760)],
    "Beauty":      [("Vitamin C Serum", 238), ("Sunscreen SPF50", 118), ("Hair Dryer Pro", 520), ("Face Mask Box", 88)],
}
CHANNELS = ["Online", "Offline", "Partner"]
CHANNEL_W = [0.52, 0.31, 0.17]
SEASON = {1: 1.24, 2: 0.92, 3: 0.97, 4: 0.94, 5: 1.01, 6: 1.18, 7: 0.95, 8: 0.98,
          9: 1.02, 10: 1.05, 11: 1.42, 12: 1.31}  # 618 / double-11 / CNY peaks

rows = []
order_id = 100000
day = date(2024, 1, 1)
for _ in range(320):
    day += timedelta(days=random.choice([1, 1, 1, 2, 2, 3]))
    if day.year > 2024:
        break
    region = random.choices(list(REGIONS), weights=[30, 24, 20, 14, 12])[0]
    city = random.choice(REGIONS[region])
    category = random.choices(list(CATEGORIES), weights=[26, 20, 18, 16, 11, 9])[0]
    product, base = random.choice(CATEGORIES[category])
    channel = random.choices(CHANNELS, weights=CHANNEL_W)[0]

    month_factor = SEASON[day.month]
    channel_factor = {"Online": 1.0, "Offline": 0.86, "Partner": 1.12}[channel]
    units = max(1, int(random.gauss(4.2, 3.0) * month_factor * channel_factor))
    unit_price = round(base * random.uniform(0.88, 1.12), 2)
    discount = round(random.choice([0, 0, 0, 0.05, 0.05, 0.1, 0.1, 0.15, 0.2, 0.25]), 2)
    revenue = round(units * unit_price * (1 - discount), 2)
    margin = random.gauss(0.30, 0.07) + (0.04 if channel == "Online" else 0)
    margin = min(0.52, max(0.08, margin))
    cost = round(revenue * (1 - margin), 2)
    profit = round(revenue - cost, 2)
    customer_age = int(min(72, max(18, random.gauss(35, 10))))
    rating = round(min(5.0, max(1.0, random.gauss(4.25, 0.55))), 1)
    returned = "Yes" if random.random() < (0.09 if category == "Apparel" else 0.035) else "No"

    order_id += 1
    rows.append({
        "order_id": order_id,
        "order_date": day.isoformat(),
        "region": region,
        "city": city,
        "category": category,
        "product": product,
        "channel": channel,
        "units": units,
        "unit_price": unit_price,
        "discount": discount,
        "revenue": revenue,
        "cost": cost,
        "profit": profit,
        "customer_age": customer_age,
        "rating": rating,
        "returned": returned,
    })

out = Path(__file__).resolve().parent.parent / "data" / "sales.csv"
out.parent.mkdir(parents=True, exist_ok=True)
with out.open("w", newline="", encoding="utf-8") as fh:
    # lineterminator must be "\n": csv's default is "\r\n", which would make this
    # the only CRLF file in the repo and disagree with .gitattributes (eol=lf).
    writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()), lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)

print(f"wrote {len(rows)} rows -> {out}")
