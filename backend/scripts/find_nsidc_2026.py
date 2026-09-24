"""Find which NSIDC short_name returns 2026 data."""
import earthaccess

earthaccess.login(strategy="netrc")

print("=" * 70)
print("Candidate short_name search")
print("=" * 70)

candidates = ["NSIDC-0081", "NSIDC-0051", "NSIDC-0779", "NSIDC-0192"]

for sn in candidates:
    print(f"\n--- {sn} ---")
    try:
        r = earthaccess.search_data(
            short_name=sn,
            temporal=("2026-01-01", "2026-06-30"),
        )
        print(f"  Found: {len(r)} granules")
        if r:
            first = r[0]
            umm = first["umm"]
            print(f"  ShortName: {umm.get('ShortName', '?')}")
            print(f"  Version:   {umm.get('Version', '?')}")
            print(f"  Example:   {umm.get('GranuleUR', '?')[:70]}")
            temporal = umm.get("TemporalExtent", {}).get("RangeDateTime", {})
            print(f"  Range:     {temporal.get('BeginningDateTime', '?')[:10]}"
                  f" → {temporal.get('EndingDateTime', '?')[:10]}")
    except Exception as e:
        print(f"  ERROR: {e}")

print()
print("=" * 70)
print("Keyword search: 'sea ice concentration'")
print("=" * 70)

r = earthaccess.search_data(
    keyword="sea ice concentration",
    temporal=("2026-01-01", "2026-06-30"),
)
print(f"\nTotal granules: {len(r)}")

seen = set()
for g in r[:50]:
    umm = g["umm"]
    key = (umm.get("ShortName"), umm.get("Version"))
    if key in seen:
        continue
    seen.add(key)
    print(f"  {umm.get('ShortName', '?'):15s} v{umm.get('Version', '?'):5s}"
          f"  {umm.get('GranuleUR', '?')[:50]}")