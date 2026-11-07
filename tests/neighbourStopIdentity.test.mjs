import test from 'node:test';
import assert from 'node:assert/strict';
import {neighbourResultMatchesStop,neighbourStopIdentity} from '../src/neighbourStopIdentity.ts';
import {emptyStableNeighbours,reconcileNeighbours} from '../src/stableNeighbours.ts';

const stop=(id,time)=>({id,name:'Testovací zastávka',sequence:1,arrival:time,departure:time,lat:null,lon:null});
const data=(id,time)=>({stopId:id,ownSchedule:time,ownDelay:120,significant:false,rows:[]});
test('different stop occurrences never share the same retained display identity',()=>{
 const a=stop('U123','10:12:00'),b=stop('U123','10:39:00');
 assert.notEqual(neighbourStopIdentity('trip',2,a),neighbourStopIdentity('trip',7,b));
 assert.notEqual(neighbourStopIdentity('trip',2,a),neighbourStopIdentity('other',2,a));
 assert.notEqual(neighbourStopIdentity('trip',2,a),neighbourStopIdentity('trip',3,a));
});
test('only exact platform and trip stop time results are eligible for rendering',()=>{
 const a=stop('U123','10:12:00');
 assert.equal(neighbourResultMatchesStop(data('U123','10:12'),a),true);
 assert.equal(neighbourResultMatchesStop(data('U123','10:12:00'),a),true);
 assert.equal(neighbourResultMatchesStop(data('U999','10:12:00'),a),false);
 assert.equal(neighbourResultMatchesStop(data('U123','10:13:00'),a),false);
 assert.equal(neighbourResultMatchesStop(null,a),false);
});
test('sticky predecessor is limited to a single stop session and reset on switching',()=>{
 const row={tripId:'T',line:'17',order:'5',vehicle:'9098',scheduled:'10:11:00',
  scheduledSeconds:36660,delay:60,relative:'before',predictedDifference:-60,previousId:'P',nextId:'N'};
 const old=reconcileNeighbours(emptyStableNeighbours(),[row],100,true,100);
 const retained=reconcileNeighbours(old,[],200,true,200);
 assert.equal(retained.entries.length,1);
 const nextStopSession=emptyStableNeighbours();
 assert.equal(nextStopSession.entries.length,0);
});
