import json, os, sys
BASE = os.path.expanduser('~/workspace/github-portfolio/geo-heat')
cache_path = os.path.join(BASE, 'places-geocode-cache.json')
cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
queue = {q['key']: q for q in json.load(open(os.path.join(BASE, 'places-queue.json')))}
new = json.load(sys.stdin)
for k, v in new.items():
    q = queue.get(k, {})
    rec = {'title': q.get('title', k), 'lists': q.get('lists', []), 'category': q.get('category', '')}
    rec.update(v)
    cache[k] = rec
json.dump(cache, open(cache_path, 'w'), ensure_ascii=False, indent=1)
ok = [v for v in cache.values() if v.get('status') == 'ok']
data = [{'n': v['title'], 'lat': round(v['lat'], 5), 'lng': round(v['lng'], 5), 'c': v['category']} for v in ok]
data.sort(key=lambda r: r['n'].lower())
with open(os.path.join(BASE, 'places-data.js'), 'w', encoding='utf-8') as fh:
    fh.write('window.PLACES_DATA = ')
    json.dump(data, fh, ensure_ascii=False)
    fh.write(';\n')
print(f"cache: {len(cache)} attempted, {len(ok)} ok, {len(cache)-len(ok)} failed")
