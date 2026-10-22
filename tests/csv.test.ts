import { it, expect } from 'vitest';
import { readCsv, writeCsv, csvEntities } from '../shared/csv.js';
it('CSV 支持中文、逗号、换行及双引号', () => {
  const row = {id:'test',name:'设备,"甲"',notes:'首行\n次行'};
  expect(readCsv(writeCsv([row]))).toEqual([row]);
});
it('CSV 拒绝列数错误且避免表格公式执行', () => {
  expect(() => readCsv('a,b\n1,2,3')).toThrow('列数');
  expect(writeCsv([{name:'=HYPERLINK("x")'}])).toContain("'=HYPERLINK");
});
it('CSV 正确还原数值、布尔和复杂字段', () => {
  const row = {id:'r',price:3,onDemand:false,bands:[{upTo:100,price:2}]};
  expect(csvEntities(writeCsv([row]))[0]).toEqual({...row,version:1});
});
