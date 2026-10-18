import json,re,subprocess,csv,urllib.parse as u
UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
def get(t,ns,i):
    url='https://mapi.dianping.com/mapi/collect/getfavoralbumdetail.bin?'+u.urlencode(dict(albumid=12498807,type=t,nextstart=ns,albumencryptid='',favorVersion='3.0'))
    s=subprocess.run(['curl','-s','-A',UA,'-H','Referer: https://h5.dianping.com/',url],capture_output=True,text=True).stdout
    open(f'raw_{i}.json','w').write(s);return json.loads(s)
d=json.load(open('r0.json'))
top={k:v for k,v in d.items() if k!='records'}
print(json.dumps(top,ensure_ascii=False)[:800])
recs=d['records']
rel=[r for r in recs if r.get('favorList')][0]
items=list(rel['favorList']);ns=rel.get('nextStart');end=rel.get('isEnd');i=1
print('showTypes',[ (r['showType'],r.get('title'),len(r.get('favorList') or [])) for r in recs])
while not end and i<50:
    r=get(1,ns,i)['records'][0];items+=r['favorList'];ns=r.get('nextStart');end=r.get('isEnd');i+=1
def txt(lst):
    out=[]
    for x in lst or []:
        if x.get('content'):
            try: out+= [t['text'].strip() for t in json.loads(x['content'])['richtextlist']]
            except: out.append(x['content'])
    return out
rows=[]
for it in items:
    j=it.get('jumpUrl') or '';q=dict(u.parse_qsl(j.split('?',1)[-1]))
    c=(it.get('shareInfo') or {}).get('content') or ''
    m=re.search(r'¥(\d+)',c);st=re.search(r'([★☆]+)',c)
    sec=txt(it.get('secondSubTitle'))
    rows.append(dict(name=it['title'],shopId=q.get('id') or it['favorInfo'].get('bizId'),uuid=q.get('shopuuid') or it['favorInfo'].get('bizUuid'),city=sec[0] if sec else '',category_area=' '.join(sec[1:]),avg_price=m.group(1) if m else '',stars=st.group(1) if st else '',shopPower=(it.get('shareInfo') or {}).get('shopPower'),reviews=' '.join(txt(it.get('firstSubTitle'))),tags='|'.join(txt(it.get('thirdSubTitle'))),cityid=q.get('cityid'),url=f"https://m.dianping.com/shop/{q.get('id') or it['favorInfo'].get('bizId')}"))
w=csv.DictWriter(open('shops.csv','w',newline='',encoding='utf-8-sig'),fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
with open('shops.md','w') as f:
    f.write('| # | 店名 | shopId | 城市 | 品类/商圈 | 人均 | 星级 | 评价 |\n|---|---|---|---|---|---|---|---|\n')
    for n,r in enumerate(rows,1): f.write(f"| {n} | {r['name']} | {r['shopId']} | {r['city']} | {r['category_area']} | {r['avg_price']} | {r['stars']} | {r['reviews']} |\n")
print(len(rows),'pages',i)
