#!/usr/bin/env python3
"""Non-deploying diagnostic of real tram-branch candidates and shape coverage."""
import argparse
from collections import Counter
import json
from pathlib import Path
from branch_geometry import incoming_points, different_incoming_branches

def analyze(root, day, limit=1500):
    directory=root/"days"/day
    entries=json.loads((directory/"platform-encounters.json").read_text())
    trip_index=json.loads((directory/"trips.json").read_text())
    stops=json.loads((root/"stops/gtfs.json").read_text())
    stop_map=json.loads((root/"stops/gtfs-map.json").read_text())
    route_cache={}
    shape_cache={}
    signature_cache={}
    def resolve(trip_id,sequence=None,physical=None):
        if trip_id not in trip_index:
            return None
        route,file=trip_index[trip_id]
        if file not in route_cache:
            route_cache[file]=json.loads((directory/"routes"/file).read_text())
            shape_cache[file]=json.loads((root/"shapes"/file).read_text()) if (root/"shapes"/file).exists() else {}
        row=route_cache[file][trip_id]
        shape=shape_cache[file].get(row[4],[])
        visits=row[6]
        valid=[i for i,s in enumerate(visits) if i>0 and
               (sequence is None or s[3]==sequence) and
               (physical is None or stop_map.get(s[0])==physical)]
        if len(valid)!=1:return None
        i=valid[0];prior=stops[visits[i-1][0]];target=stops[visits[i][0]]
        key=(row[4],visits[i-1][0],visits[i][0])
        if key not in signature_cache:
            signature_cache[key]=incoming_points(shape,(prior["a"],prior["o"]),(target["a"],target["o"]))
        return signature_cache[key]
    stats=Counter()
    examples=[]
    for trip_id,rows in entries.items():
        for sequence,physical,kind,peers in rows:
            if kind!="tram-branch-candidate":continue
            for peer_id in peers:
                stats["examined"]+=1
                one=resolve(trip_id,sequence,physical)
                two=resolve(peer_id,None,physical)
                if one is None:stats["own-unmatched"]+=1
                if two is None:stats["peer-unmatched"]+=1
                if one is not None and two is not None:
                    stats["both-matched"]+=1
                    if different_incoming_branches(one,two):
                        stats["branch-proven"]+=1
                    else:
                        from math import hypot
                        near=hypot(one[0][0]-two[0][0],one[0][1]-two[0][1])
                        far=hypot(one[1][0]-two[1][0],one[1][1]-two[1][1])
                        if len(examples)<15:examples.append({"platform":physical,"nearM":round(near),"farM":round(far)})
                if stats["examined"]>=limit:
                    return {"counts":dict(stats),"rejectedGeometryExamples":examples}
    return {"counts":dict(stats),"rejectedGeometryExamples":examples}
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("root",type=Path);p.add_argument("day");args=p.parse_args()
    print(json.dumps(analyze(args.root,args.day),ensure_ascii=False,indent=2))
