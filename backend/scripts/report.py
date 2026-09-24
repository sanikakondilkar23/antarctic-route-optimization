import csv, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
seeds = [
    (0, os.path.join(ROOT, 'runs', 'final_10ch_1f_bce_seed0', 'training_log.csv')),
    (1, os.path.join(ROOT, 'runs', 'final_10ch_1f_bce_seed1', 'training_log.csv')),
    (2, os.path.join(ROOT, 'runs', 'final_10ch_1f_bce_seed2', 'training_log.csv')),
]

print("Seed | Epochs | Best ep | miz_day1 | persist_day1 | val_loss | Wall (min)")
print("-----|--------|---------|----------|--------------|----------|-----------")
for s, path in seeds:
    rows = list(csv.DictReader(open(path)))
    best = min(rows, key=lambda r: float(r['miz_day1']))
    wall = sum(float(r['time_s']) for r in rows) / 60.0
    dec = float(rows[-1]['val_loss']) < float(rows[-2]['val_loss'])
    print(f"  {s}  |  {len(rows):4d}   |  {best['epoch']:>5s}   | {best['miz_day1']:<8s} |  {best['persist_day1']:<9s} | {best['val_loss']:<8s} |  {wall:.1f}")
    print(f"      |        |         |          |              |          |  val_loss dec at stop: {dec}")
