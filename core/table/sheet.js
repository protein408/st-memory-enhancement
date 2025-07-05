import { BASE, DERIVED, EDITOR, SYSTEM, USER } from '../manager.js';
import { SheetBase } from "./base.js";
import { cellStyle, filterSavingData } from "./utils.js";
import { Cell } from "./cell.js";
/**
 * 테이블类，用于管理테이블数据
 * @description 테이블类用于管理테이블数据，包括테이블的名称、域、类型、单元格数据等
 * @description 테이블类还提供了对테이블的 작업，包括创建、저장、删除、渲染等
 */
export class Sheet extends SheetBase {
    constructor(target = null) {
        super(target);

        this.currentPopupMenu = null;           // 用于跟踪当前弹出的菜单 - 移动到 Sheet (如果需要PopupMenu仍然在Sheet中管理)
        this.element = null;                    // 用于存储渲染后的 table 元素
        this.lastCellEventHandler = null;       // 저장最后一次使用的 cellEventHandler
        this.template = null;       // 用于存储模板
        this.#load(target);
    }

    /**
     * 渲染테이블
     * @description 接受 cellEventHandler 参数，提供一个 `Cell` 对象作为回调函数参数，用于处理单元格事件
     * @description 可以通过 `cell.parent` 获取 Sheet 对象，因此不再需要传递 Sheet 对象
     * @description 如果不传递 cellEventHandler 参数，则使用上一次的 cellEventHandler
     * @param {Function} cellEventHandler
     * @param targetHashSheet
     * */
    renderSheet(cellEventHandler = this.lastCellEventHandler, targetHashSheet = this.hashSheet) {
        this.lastCellEventHandler = cellEventHandler;

        this.element = document.createElement('table');
        this.element.classList.add('sheet-table', 'tableDom');
        this.element.style.position = 'relative';
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';
        this.element.style.flexGrow = '0';
        this.element.style.flexShrink = '1';

        const styleElement = document.createElement('style');
        styleElement.textContent = cellStyle;
        this.element.appendChild(styleElement);

        const tbody = document.createElement('tbody');
        this.element.appendChild(tbody);
        // 清空 tbody 的内容
        tbody.innerHTML = '';

        // 遍历 hashSheet，渲染每一个单元格
        targetHashSheet.forEach((rowUids, rowIndex) => {
            const rowElement = document.createElement('tr');
            rowUids.forEach((cellUid, colIndex) => {
                let cell = this.cells.get(cellUid)
                if (!cell) {
                    console.warn(`Cell not found: ${cellUid}`);
                    cell = new Cell(this); // 如果没有找到对应的单元格，则创建一个新的 Cell 实例
                    cell.uid = cellUid; // 设置 uid
                    cell.data = { value: '' }; // 初始化数据
                    this.cells.set(cellUid, cell); // 将新创建的单元格添加到 cells 中
                }
                const cellElement = cell.initCellRender(rowIndex, colIndex);
                rowElement.appendChild(cellElement);    // 调用 Cell 的 initCellRender 方法，仍然需要传递 rowIndex, colIndex 用于渲染单元格内容
                if (cellEventHandler) {
                    cellEventHandler(cell);
                }
            });
            tbody.appendChild(rowElement); // 将 rowElement 添加到 tbody 中
        });
        return this.element;
    }

    /**
     * 저장테이블数据
     * @returns {Sheet|boolean}
     */
    save(targetPiece = USER.getChatPiece()?.piece, manualSave = false) {
        const sheetDataToSave = this.filterSavingData()
        sheetDataToSave.template = this.template?.uid;

        let sheets = BASE.sheetsData.context ?? [];
        try {
            if (sheets.some(t => t.uid === sheetDataToSave.uid)) {
                sheets = sheets.map(t => t.uid === sheetDataToSave.uid ? sheetDataToSave : t);
            } else {
                sheets.push(sheetDataToSave);
            }
            BASE.sheetsData.context = sheets;
            if (!targetPiece) {
                console.log("没用消息能承载hash_sheets数据，不予저장")
                return this
            }
            if (!targetPiece.hash_sheets) targetPiece.hash_sheets = {};
            targetPiece.hash_sheets[this.uid] = this.hashSheet?.map(row => row.map(hash => hash));
            console.log('저장테이블数据', targetPiece, this.hashSheet);
            if (!manualSave) USER.saveChat();

            return this;
        } catch (e) {
            EDITOR.error(`템플릿 저장 실패：${e}`);
            return false;
        }
    }

    /**
     * 创建新的 Sheet 实例
     * @returns {Sheet} - 返回新的 Sheet 实例
     */
    createNewSheet(column = 2, row = 2, isSave = true) {
        this.init(column, row);     // 初始化基本数据结构
        this.uid = `sheet_${SYSTEM.generateRandomString(8)}`;
        this.name = `새 테이블_${this.uid.slice(-4)}`;
        if (isSave) this.save();    // 저장新创建的 Sheet
        return this;                // 返回 Sheet 实例自身
    }

    /**
     * 获取테이블内容的提示词，可以通过指定['title', 'node', 'headers', 'rows', 'editRules']中的部分，只获取部分内容
     * @returns 테이블内容提示词
     */
    getTableText(index, customParts = ['title', 'node', 'headers', 'rows', 'editRules']) {
        console.log('获取테이블内容提示词', this)
        if (this.triggerSend && this.triggerSendDeep < 1) return ''; // 如果触发深度=0，则不发送，可以用作信息一览表
        const title = `* ${index}:${this.name}\n`;
        const node = this.source.data.note && this.source.data.note !== '' ? '【설명】' + this.source.data.note + '\n' : '';
        const headers = "rowIndex," + this.getCellsByRowIndex(0).slice(1).map((cell, index) => index + ':' + cell.data.value).join(',') + '\n';
        let rows = this.getSheetCSV()
        const editRules = this.#getTableEditRules() + '\n';
        // 新增触发式테이블内容发送，检索聊天内容的角色名


        if (rows && this.triggerSend) {
            const chats = USER.getContext().chat;
            console.log("进入触发发送模式,测试获取chats", chats)
            // 提取所有聊天内容中的 content 值
            const chat_content = getLatestChatHistory(chats, this.triggerSendDeep)
            console.log('获取聊天内容: ', chat_content)
            console.log("聊天内容类型:", typeof (chat_content))
            const rowsArray = rows.split('\n').filter(line => {
                line = line.trim();
                if (!line) return false;
                const parts = line.split(',');
                const str1 = parts?.[1] ?? ""; // 字符串1对应索引1
                return chat_content.includes(str1);
            });
            rows = rowsArray.join('\n');
        }
        let result = '';
        console.log('测试获取테이블内容提示词', customParts, result, this);
        if (customParts.includes('title')) {
            result += title;
        }
        if (customParts.includes('node')) {
            result += node;
        }
        if (customParts.includes('headers')) {
            result += '【테이블 내용】\n' + headers;
        }
        if (customParts.includes('rows')) {
            result += rows;
        }
        if (customParts.includes('editRules')) {
            result += editRules;
        }
        return result;
    }


    /**
     * 获取테이블的content数据（与旧版兼容）
     * @returns {string[][]} - 返回테이블的content数据
     */
    getContent(withHead = false) {
        if (!withHead && this.isEmpty()) return [];
        const content = this.hashSheet.map((row) =>
            row.map((cellUid) => {
                const cell = this.cells.get(cellUid);
                if (!cell) return "";
                return cell.data.value;
            })
        );

        // 去掉每一行的第一个元素
        const trimmedContent = content.map(row => row.slice(1));
        if (!withHead) return trimmedContent.slice(1);
        return content;
    }

    getJson() {
        const sheetDataToSave = this.filterSavingData(["uid", "name", "domain", "type", "enable", "required", "tochat", "triggerSend", "triggerSendDeep", "config", "sourceData", "content"])
        delete sheetDataToSave.cellHistory
        delete sheetDataToSave.hashSheet
        sheetDataToSave.sourceData = this.source.data
        sheetDataToSave.content = this.getContent(true)
        return sheetDataToSave
    }
    /** _______________________________________ 以下函数不进行外部调用 _______________________________________ */

    #load(target) {
        if (target == null) {
            return this;
        }
        if (typeof target === 'string') {
            let targetSheetData = BASE.sheetsData.context?.find(t => t.uid === target);
            if (targetSheetData?.uid) {
                this.loadJson(targetSheetData)
                return this;
            }
            throw new Error('해당하는 템플릿을 찾을 수 없습니다.');
        }
        if (typeof target === 'object') {
            if (target.domain === this.SheetDomain.global) {
                console.log('从模板转化테이블', target, this);
                this.loadJson(target)
                this.domain = 'chat'
                this.uid = `sheet_${SYSTEM.generateRandomString(8)}`;
                this.name = this.name.replace('템플릿', '테이블');
                this.template = target;
                return this
            } else {
                this.loadJson(target)
                return this;
            }
        }
    }
    /**
     * 获取테이블编辑规则提示词
     * @returns
     */
    #getTableEditRules() {
        const source = this.source;
        if (this.required && this.isEmpty()) return '【추가/삭제/수정 트리거 조건】\n삽입：' + source.data.initNode + '\n'
        else {
            let editRules = '【추가/삭제/수정 트리거 조건】\n'
            if (source.data.insertNode) editRules += ('삽입：' + source.data.insertNode + '\n')
            if (source.data.updateNode) editRules += ('更新：' + source.data.updateNode + '\n')
            if (source.data.deleteNode) editRules += ('删除：' + source.data.deleteNode + '\n')
            return editRules
        }
    }

    /**
     * 初始化hashSheet，只保留表头
     */
    initHashSheet() {
        this.hashSheet = [this.hashSheet[0].map(uid => uid)];
        this.markPositionCacheDirty();
    }

    /**
     * 根据 "A1" 格式的地址获取单元格
     * @param {string} address - 例如 "A1", "B2"
     * @returns {Cell|null}
     */
    getCellFromAddress(address) {
        if (typeof address !== 'string' || !/^[A-Z]+\d+$/.test(address)) {
            return null;
        }

        const colStr = address.match(/^[A-Z]+/)[0];
        const rowStr = address.match(/\d+$/)[0];

        const row = parseInt(rowStr, 10) - 1;

        let col = 0;
        for (let i = 0; i < colStr.length; i++) {
            col = col * 26 + (colStr.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
        }
        col -= 1;

        if (row < 0 || col < 0) return null;

        const cellUid = this.hashSheet?.[row]?.[col];
        return cellUid ? this.cells.get(cellUid) : null;
    }
}

/**
 * 获取制定深度的聊天历史内容
 * @param {当前聊天文件} chat 
 * @param {扫描深度} deep 
 * @returns string
 */
function getLatestChatHistory(chat, deep) {
    let filteredChat = chat;

    let collected = "";
    const floors = filteredChat.length
    // 从最新记录开始逆序遍历，最大不超过聊天记录最大楼层
    for (let i = 0; i < Math.min(deep, floors); i++) {
        // 格式化消息并清理标签
        const currentStr = `${filteredChat[floors - i - 1].mes}`
            .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/g, '');
        collected += currentStr;
    }
    return collected;
}