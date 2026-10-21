import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpeningBalanceRunner } from '../src/lib/services/opening-balance-workflow-ui';

const fixture = () => { const events: string[] = []; const runner = createOpeningBalanceRunner<string>({ saving: (v) => events.push(`saving:${v}`), error: (m) => events.push(`error:${m}`), loaded: (v) => events.push(`loaded:${v}`), savedButStale: (m) => events.push(`stale:${m}`) }); return { events, runner }; };

test('opening UI exposes read failure without publishing stale data', async () => { const f=fixture(); await f.runner.load(async()=>{throw new Error('read failed');}); assert.deepEqual(f.events,['error:read failed']); });
test('opening UI locks duplicates through write and refresh', async () => { const f=fixture(); let release!:()=>void; const first=f.runner.submit(()=>new Promise<void>((r)=>{release=r;}),async()=>'new'); assert.equal(await f.runner.submit(async()=>{},async()=>'duplicate'),null); release(); await first; assert.equal(f.events.filter((e)=>e==='loaded:new').length,1); });
test('saved write with failed refresh is distinct from rejection', async () => { const f=fixture(); await f.runner.load(async()=>'old'); await f.runner.submit(async()=>{},async()=>{throw new Error('refresh failed');}); assert.ok(f.events.includes('stale:refresh failed')); assert.equal(f.events.includes('error:refresh failed'),false); });
test('rejected and stale corrections keep displayed state and release submission', async () => { const f=fixture(); await f.runner.load(async()=>'confirmed:10'); await f.runner.submit(async()=>{throw new Error('changed; refresh');},async()=>'wrong'); await f.runner.submit(async()=>{},async()=>'confirmed:20'); assert.ok(f.events.includes('error:changed; refresh')); assert.equal(f.events.includes('loaded:wrong'),false); assert.ok(f.events.includes('loaded:confirmed:20')); assert.equal(f.events.at(-1),'saving:false'); });
