import { describe,it,expect } from 'vitest';
import JSZip from 'jszip';
import { previewAirImport,workbookRows } from '../server/air-import.js';
import { airFixture,importRows,importOptions } from './air-fixture.js';
import { readCsvRows } from '../shared/csv.js';

async function workbook(sheet:string,extra=''){
  const zip=new JSZip();zip.file('xl/workbook.xml','<workbook><sheets><sheet r:id="rId1"/></sheets></workbook>');zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');zip.file('xl/worksheets/sheet1.xml',sheet);if(extra)zip.file('xl/sharedStrings.xml',extra);return zip.generateAsync({type:'nodebuffer'});
}
describe('航空时刻导入',()=>{
  it('匹配机场别名及三字码，复用供应商航线，将周期和指定日期分别建为子记录',async()=>{
    const c=airFixture().catalog,preview=await previewAirImport({...importOptions,rows:importRows},c);
    expect(preview.errors).toEqual([]);expect(preview.rows.every(r=>r.action==='new')).toBe(true);expect(preview.newLanes).toBe(0);expect(preview.newFlights).toBe(3);
    expect(preview.catalog.flights[0]).toMatchObject({flightNumber:'XX1234',weekdays:[1],timeZone:'Asia/Shanghai',aircraft:'TEST-F',registration:'TEST-REG',status:'planned',cutoffHours:null});
    expect(preview.catalog.flights[2]).toMatchObject({kind:'date',operatingDate:'2026-10-26',weekdays:[]});
    c.flights=preview.catalog.flights;
    const again=await previewAirImport({...importOptions,rows:importRows},c);expect(again.newFlights).toBe(0);expect(again.existing).toBe(3);
  });
  it('创建没有虚构耗时、运价和承运能力的父航线',async()=>{
    const c=airFixture().catalog;c.lanes=[];
    const p=await previewAirImport({...importOptions,rows:importRows},c);expect(p.newLanes).toBe(1);expect(p.newFlights).toBe(3);expect(p.errors).toEqual([]);
    expect(p.catalog.lanes[0]).toMatchObject({onDemand:false,validityUnknown:true,capabilities:{hazardous:'unknown'}});expect(p.catalog.lanes[0].transitHours).toBeUndefined();expect(p.catalog.rates).toEqual([]);
  });
  it('相同时刻跳过，时间冲突、未维护机场和日期星期矛盾均明确报错',async()=>{
    const c=airFixture().catalog;c.flights=(await previewAirImport({...importOptions,rows:importRows},c)).catalog.flights;
    const changed=structuredClone(importRows);changed[1][3]='03:05';changed[2][2]='NOT';changed[3][8]=3;
    const p=await previewAirImport({...importOptions,rows:changed},c);expect(p.rows.map(r=>r.action)).toEqual(['error','error','error']);expect(p.rows[0].errors.join()).toContain('编辑原记录');expect(p.rows[1].errors.join()).toContain('尚未维护');expect(p.rows[2].errors.join()).toContain('星期不一致');
  });
  it('XLSX 读取共享字符串、保留空格的富文本、时间小数，并展开合并单元格',async()=>{
    const buffer=await workbook('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t xml:space="preserve"> A &amp; B </t></is></c></row><row r="2"><c r="A2" t="n"><v>0.125</v></c></row></sheetData><mergeCells><mergeCell ref="B1:B2"/></mergeCells></worksheet>','<sst><si><r><t>航</t></r><r><t>班号</t></r></si></sst>');
    expect(await workbookRows(buffer)).toEqual([['航班号',' A & B '],[0.125,' A & B ']]);
    const rows=structuredClone(importRows);rows[1][3]=0.125;
    expect((await previewAirImport({...importOptions,rows},airFixture().catalog)).catalog.flights[0].offBlockTime).toBe('03:00');
  });
  it('CSV 允许相同航站表头；不接受公式或实体声明的 XLSX',async()=>{
    const rows=readCsvRows('\uFEFF航班号,航站,航站\r\nXX1234,CTU,PRG');expect(rows[0]).toEqual(['航班号','航站','航站']);
    await expect(workbookRows(await workbook('<worksheet><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>'))).rejects.toThrow('公式');
    await expect(workbookRows(await workbook('<!DOCTYPE x [<!ENTITY a "foo">]><worksheet/>'))).rejects.toThrow('实体');
  });
  it('跨日必须显式标明，年份不能默认为其他年份',async()=>{
    const rows=structuredClone(importRows.slice(0,2));rows[1][3]='23:00';rows[1][4]='23:20';rows[1][5]='09:00';rows[1][6]='09:15';
    expect((await previewAirImport({...importOptions,rows},airFixture().catalog)).rows[0].action).toBe('error');
    rows[0].push('落地跨日','到达跨日');rows[1].push(1,1);
    expect((await previewAirImport({...importOptions,rows},airFixture().catalog)).catalog.flights[0].arrivalDayOffset).toBe(1);
    rows[1][9]='2025-10-26';expect((await previewAirImport({...importOptions,rows},airFixture().catalog)).rows[0].errors.join()).toContain('年份');
  });
});
