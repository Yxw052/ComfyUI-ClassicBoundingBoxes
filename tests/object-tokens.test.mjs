import test from 'node:test';
import assert from 'node:assert/strict';
import { objectTokenOptions, objectTokenQuery, filterObjectTokens } from '../web/object-tokens.js';

test('each box gets its FLUX.3 array-order ID, including text boxes', () => {
    const options = objectTokenOptions([{metadata:{desc:'梨'}},{type:'text',text:'中文'}]);
    assert.deepEqual(options.map(item=>[item.token,item.label]),[['<obj_1>','梨'],['<obj_2>','中文']]);
    assert.deepEqual(objectTokenOptions([]),[]);
});
test('all requested triggers work; partial references filter by ID', () => {
    const options = objectTokenOptions(Array(12).fill({}));
    for(const trigger of ['<','>','o','b','j','_','obj','<ob']) {
        const value='移除'+trigger;
        const range=objectTokenQuery(value,value.length);
        assert.equal(range.start,2);
        assert.equal(filterObjectTokens(options,range.query).length,12);
    }
    assert.deepEqual(filterObjectTokens(options,'2').map(item=>item.token),['<obj_2>','<obj_12>']);
    assert.deepEqual(filterObjectTokens(options,'<obj_12').map(item=>item.token),['<obj_12>']);
    assert.deepEqual(filterObjectTokens(options,'o_2').map(item=>item.token),['<obj_2>','<obj_12>']);
});
test('replacement ranges preserve surrounding prose and handle existing references', () => {
    assert.deepEqual(objectTokenQuery('前文<后文',3),{start:2,end:3,query:'<'});
    assert.deepEqual(objectTokenQuery('前文<obj_12>后文',8),{start:2,end:10,query:'<obj_1'});
    assert.deepEqual(objectTokenQuery('<obj_1><',8),{start:7,end:8,query:'<'});
    assert.deepEqual(objectTokenQuery('remove<',7),{start:6,end:7,query:'<'});
    assert.equal(objectTokenQuery('photo',5),null);
    assert.equal(objectTokenQuery('123',1,2),null);
    assert.equal(objectTokenQuery('<obj_1>',7),null);
    assert.equal(objectTokenQuery('描述 ',3),null);
});
