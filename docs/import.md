# 资源导入指南

界面可手工录入所有字段。批量导入支持 UTF-8 CSV 和资源 JSON 备份，大小不超过 5 MB。

## 推荐顺序

供应商 → 机场 / 运输节点 → 分段线路 → 飞行时刻 / 运价 → 汇率。机场是全局共享资料，供应商拥有航线，航线可有零条或多条独立飞行时刻。跨表关联使用稳定 ID。ID 可由字母、数字、横线、下划线和点组成，首字符必须是字母或数字，最长 100 位。

CSV 只导入当前分类。点击该分类「CSV 模板」获得字段示例；示例业务数据需替换，机场示例使用公共机场资料。JSON 可同时包含 suppliers、airports、nodes、lanes、flights、rates、fx 数组，允许在一批内导入互相关联资源。先预览，再提交，服务端再次校验后原子写入。

导入仅新增，不覆盖已存在 ID。修改已有资源请使用编辑，避免批量文件意外改写其他人的资料。空白 CSV id 会自动生成；其他资源要引用时应提前指定 ID。version 由系统管理。

## 主要字段约定

| 分类 | 字段 |
| --- | --- |
| 供应商 | id、name、contact、notes |
| 机场 | id、name（中文）、nameEn（英文）、iata、country、city、cityId、timeZone、aliases、notes |
| 节点 | id、name、city、cityId、country、type、timeZone |
| 线路 | id、name、supplierId、from、to、mode、transitHours、handlingHours、validFrom、validTo、onDemand、schedule、capabilities、尺寸重量上限、services |
| 飞行时刻 | id、laneId、flightNumber、kind、validFrom、validTo、operatingDate、weekdays、timeZone、offBlockTime、takeoffTime、landingTime、onBlockTime、takeoffDayOffset、landingDayOffset、arrivalDayOffset、aircraft、registration、cutoffHours、status、source |
| 运价 | id、name、laneId、currency、unit、price、minimum、rounding、volumetricDivisor、bands、surcharges、containerType、validFrom、validTo |
| 汇率 | id、currency、toCny、validFrom、validTo |

日期为 YYYY-MM-DD；币种为三位大写字母。国家存储 ISO 两位代码（如 CN / GB / US），兼容可识别的旧国家名称。cityId 为 GeoNames 城市 ID；同名城市必须提供 ID 明确归属。节点时区例：Asia/Shanghai、Europe/London、America/New_York。

type：city / warehouse / airport / port / rail / border。mode：road / rail / air / sea / transfer。

unit：kg / chargeableKg / cbm / vehicle / container / shipment。onDemand：true / false。尺寸上限单位为 cm，重量为 kg，体积为 m³。

capabilities 中 oversized、hazardous、batteryInstalled、batteryPacked、batteryOnly、liquid、temperature 分别填写 yes / no / unknown。复杂字段在 CSV 单元格内按模板 JSON 格式维护；建议这些字段先用界面录入，再导出查看结构。

示例班期：`{"weekdays":[1,3,5],"departureTime":"18:00","timeZone":"Asia/Shanghai","cutoffHours":8}`。星期日为 0，星期六为 6。

示例阶梯：`[{"upTo":100,"price":25},{"upTo":500,"price":22}]`。示例附加费：`[{"name":"燃油","kind":"percent","amount":10}]`。

缺省值和全部数据约束以 `shared/model.ts` 为准。服务范围说明不要包含应在客户版隐藏的供应商联系信息；自由文本不会自动识别、删除商业名称。

## 航空航线与时刻导入

在「分段线路」或「飞行时刻」点击「导入航线时刻」，选择供应商、年份、默认月份和表内时区。支持第一张工作表为数据表的 XLSX 或 UTF-8 CSV，最多 5 MB、2000 行。XLSX 展开合并单元格，支持共享字符串及 Excel 时间小数；公式须先转为值，1904 日期系统须转为标准日期系统或文本 CSV。CSV 每行须重复起止机场、航班号和执行日期，空白值不会擅自继承上一行。截图须人工核对转成表格，系统不自动 OCR。

表头支持「起飞机场、目的机场、航班号、撤轮时间、起飞时间、落地时间、挡轮时间、班期、执行日期、执飞机型、机号、起飞跨日、落地跨日、到达跨日」；供应商原表的两个同名「航站」依次对应起止机场。以三字码、中文名、英文名或别名精确匹配机场；不存在或匹配多义时先补机场资料，不凭城市推断机场。

班期 `1,3,5` 为周一、三、五，`7` 为周日（内部存储周日为 0）。执行日期如 `10月1-25日` 表示所选年份内的周期有效区间；`10月26日` 或 `2026-10-26` 为指定日期。指定日期提供班期星期时必须与实际日期一致。四项时间统一按所选时区解释，通常为 `Asia/Shanghai`；与机场当地时区独立。跨日按整数偏移填写，系统不会猜测翌日。截货未知保持 null，不视为已确认的零小时。

同一供应商、起止机场唯一匹配时复用航线，否则新建航线；同一组合存在多条父航线时要求先明确。新航线不推定运价、承运能力、尺寸重量限制或经营有效期，时刻默认为「计划 / 待确认」。同身份且时间、时区、机型、机号一致的时刻跳过；有差异则报冲突，需在原记录编辑并留存修订。周期区间重叠与重复指定日期由服务端阻止，整批失败不落部分数据。预览后提交期间发生资料变化会再次校验。

机场自动派生同 ID 的运输节点，后续在「机场」统一修改；航空航线用 fromAirportId、toAirportId 关联机场，不再内嵌 schedule，也不能设为按需发运。旧线路保持兼容读取，需人工关联机场后再转为独立时刻。机场别名、时刻来源与原始资料核对后维护。真实供应商资料及原文件只保存到私有数据库或本机忽略目录，不上传公开 GitHub。
