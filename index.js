import { APP, BASE, DERIVED, EDITOR, SYSTEM, USER } from './core/manager.js';
import { openTableRendererPopup, updateSystemMessageTableStatus } from "./scripts/renderer/tablePushToChat.js";
import { loadSettings } from "./scripts/settings/userExtensionSetting.js";
import { ext_getAllTables, ext_exportAllTablesAsJson } from './scripts/settings/standaloneAPI.js';
import { openTableDebugLogPopup } from "./scripts/settings/devConsole.js";
import { TableTwoStepSummary } from "./scripts/runtime/separateTableUpdate.js";
import { initTest } from "./components/_fotTest.js";
import { initAppHeaderTableDrawer, openAppHeaderTableDrawer } from "./scripts/renderer/appHeaderTableBaseDrawer.js";
import { initRefreshTypeSelector } from './scripts/runtime/absoluteRefresh.js';
import {refreshTempView, updateTableContainerPosition} from "./scripts/editor/tableTemplateEditView.js";
import { functionToBeRegistered } from "./services/debugs.js";
import { parseLooseDict, replaceUserTag } from "./utils/stringUtil.js";
import {executeTranslation} from "./services/translate.js";
import applicationFunctionManager from "./services/appFuncManager.js"


console.log("______________________메모리 플러그인: 로딩 시작______________________")

const VERSION = '2.1.1'

const editErrorInfo = {
    forgotCommentTag: false,
    functionNameError: false,
}

/**
 * 값 중의 잘못된 이스케이프 단일 따옴표 수정
 * @param {*} value
 * @returns
 */
function fixUnescapedSingleQuotes(value) {
    if (typeof value === 'string') {
        return value.replace(/\\'/g, "'");
    }
    if (typeof value === 'object' && value !== null) {
        for (const key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                value[key] = fixUnescapedSingleQuotes(value[key]);
            }
        }
    }
    return value;
}

/**
 * 테이블 인덱스를 통해 테이블 구조 찾기
 * @param {number} index 테이블 인덱스
 * @returns 이 인덱스의 테이블 구조
 */
export function findTableStructureByIndex(index) {
    return USER.tableBaseSetting.tableStructure[index];
}

/**
 * 데이터가 Sheet 인스턴스인지 확인하고, 아니면 새 Sheet 인스턴스로 변환
 * @param {Object[]} dataTable 모든 테이블 객체 배열
 */
function checkPrototype(dataTable) {
    // 기존 Table 인스턴스 확인 로직이 제거됨
    // 이제 새로운 Sheet 클래스를 사용하여 테이블 데이터 처리
    // 이 함수는 기존 코드 호출과의 호환성을 위해 유지되지만 내부 로직은 업데이트됨
    return dataTable;
}

export function buildSheetsByTemplates(targetPiece) {
    BASE.sheetsData.context = [];
    // USER.getChatPiece().hash_sheets = {};
    const templates = BASE.templates
    templates.forEach(template => {
        if(template.enable === false) return

        // template 구조 확인
        if (!template || !template.hashSheet || !Array.isArray(template.hashSheet) || template.hashSheet.length === 0 || !Array.isArray(template.hashSheet[0]) || !template.cellHistory || !Array.isArray(template.cellHistory)) {
            console.error(`[Memory Enhancement] buildSheetsByTemplates에서 잘못된 템플릿 구조 발견 (hashSheet 또는 cellHistory 누락). 템플릿 건너뛰기:`, template);
            return; // 이 템플릿 처리 건너뛰기
        }
        try {
            const newSheet = BASE.createChatSheetByTemp(template);
            newSheet.save(targetPiece);
        } catch (error) {
            EDITOR.error(`[Memory Enhancement] 템플릿에서 sheet 생성 또는 저장 중 오류:`, "", error);
        }
    })
    BASE.updateSelectBySheetStatus()
    USER.saveChat()
}

/**
 * 기존 테이블을 sheets로 변환
 * @param {DERIVED.Table[]} oldTableList 기존 테이블 데이터
 */
export function convertOldTablesToNewSheets(oldTableList, targetPiece) {
    //USER.getChatPiece().hash_sheets = {};
    const sheets = []
    for (const oldTable of oldTableList) {
        const valueSheet = [oldTable.columns, ...oldTable.content].map(row => ['', ...row])
        const cols = valueSheet[0].length
        const rows = valueSheet.length
        const targetSheetUid = BASE.sheetsData.context.find(sheet => sheet.name === oldTable.tableName)?.uid
        if (targetSheetUid) {
            // 테이블이 이미 존재하면 테이블 데이터 업데이트
            const targetSheet = BASE.getChatSheet(targetSheetUid)
            console.log("테이블이 이미 존재함, 테이블 데이터 업데이트", targetSheet)
            targetSheet.rebuildHashSheetByValueSheet(valueSheet)
            targetSheet.save(targetPiece)
            addOldTablePrompt(targetSheet)
            sheets.push(targetSheet)
            continue
        }
        // 테이블이 존재하지 않으면 새 테이블 생성
        const newSheet = BASE.createChatSheet(cols, rows);
        newSheet.name = oldTable.tableName
        newSheet.domain = newSheet.SheetDomain.chat
        newSheet.type = newSheet.SheetType.dynamic
        newSheet.enable = oldTable.enable
        newSheet.required = oldTable.Required
        newSheet.tochat = true
        newSheet.triggerSend = false
        newSheet.triggerSendDeep = 1

        addOldTablePrompt(newSheet)
        newSheet.data.description = `${oldTable.note}\n${oldTable.initNode}\n${oldTable.insertNode}\n${oldTable.updateNode}\n${oldTable.deleteNode}`

        valueSheet.forEach((row, rowIndex) => {
            row.forEach((value, colIndex) => {
                const cell = newSheet.findCellByPosition(rowIndex, colIndex)
                cell.data.value = value
            })
        })

        newSheet.save(targetPiece)
        sheets.push(newSheet)
    }
    // USER.saveChat()
    console.log("기존 테이블 데이터를 새 테이블 데이터로 변환", sheets)
    return sheets
}

/**
 * 기존 테이블 구조의 프롬프트를 새 테이블에 추가
 * @param {*} sheet 테이블 객체
 */
function addOldTablePrompt(sheet) {
    const tableStructure = USER.tableBaseSetting.tableStructure.find(table => table.tableName === sheet.name)
    console.log("기존 테이블 프롬프트 추가", tableStructure, USER.tableBaseSetting.tableStructure, sheet.name)
    if (!tableStructure) return false
    const source = sheet.source
    source.required = tableStructure.Required
    source.data.initNode = tableStructure.initNode
    source.data.insertNode = tableStructure.insertNode
    source.data.updateNode = tableStructure.updateNode
    source.data.deleteNode = tableStructure.deleteNode
    source.data.note = tableStructure.note
}

/**
 * 테이블 데이터를 포함한 다음 메시지 찾기, 찾을 수 없으면 null 반환
 * @param startIndex 검색을 시작할 인덱스
 * @param isIncludeStartIndex 시작 인덱스를 포함할지 여부
 * @returns 찾은 mes 데이터
 */
export function findNextChatWhitTableData(startIndex, isIncludeStartIndex = false) {
    if (startIndex === -1) return { index: - 1, chat: null }
    const chat = USER.getContext().chat
    for (let i = isIncludeStartIndex ? startIndex : startIndex + 1; i < chat.length; i++) {
        if (chat[i].is_user === false && chat[i].dataTable) {
            checkPrototype(chat[i].dataTable)
            return { index: i, chat: chat[i] }
        }
    }
    return { index: - 1, chat: null }
}

/**
 * 테이블 데이터를 포함한 마지막 메시지를 검색하고 프롬프트 생성
 * @returns 생성된 완전한 프롬프트
 */
export function initTableData(eventData) {
    const allPrompt = USER.tableBaseSetting.message_template.replace('{{tableData}}', getTablePrompt(eventData))
    const promptContent = replaceUserTag(allPrompt)  //모든 <user> 태그 교체
    console.log("완전한 프롬프트", promptContent)
    return promptContent
}

/**
 * 테이블 관련 프롬프트 가져오기
 * @returns {string} 테이블 관련 프롬프트
 */
export function getTablePrompt(eventData, isPureData = false) {
    const lastSheetsPiece = BASE.getReferencePiece()
    if(!lastSheetsPiece) return ''
    console.log("가져온 참조 테이블 데이터", lastSheetsPiece)
    return getTablePromptByPiece(lastSheetsPiece, isPureData)
}

/**
 * piece를 통해 테이블 관련 프롬프트 가져오기
 * @param {Object} piece 채팅 조각
 * @returns {string} 테이블 관련 프롬프트
 */
export function getTablePromptByPiece(piece, isPureData = false) {
    const {hash_sheets} = piece
    const sheets = BASE.hashSheetsToSheets(hash_sheets)
        .filter(sheet => sheet.enable)
        .filter(sheet => sheet.sendToContext !== false);
    console.log("프롬프트 구성 시 정보 (필터링됨)", hash_sheets, sheets)
    const customParts = isPureData ? ['title', 'headers', 'rows'] : ['title', 'node', 'headers', 'rows', 'editRules'];
    const sheetDataPrompt = sheets.map((sheet, index) => sheet.getTableText(index, customParts, piece)).join('\n')
    return sheetDataPrompt
}

/**
 * 매칭된 전체 문자열을 개별 명령문 배열로 변환
 * @param {string[]} matches 매칭된 전체 문자열
 * @returns 단일 실행 명령문 배열
 */
function handleTableEditTag(matches) {
    const functionRegex = /(updateRow|insertRow|deleteRow)\(/g;
    let A = [];
    let match;
    let positions = [];
    matches.forEach(input => {
        while ((match = functionRegex.exec(input)) !== null) {
            positions.push({
                index: match.index,
                name: match[1].replace("Row", "") // update/insert/delete로 변환
            });
        }

        // 함수 조각과 위치 병합
        for (let i = 0; i < positions.length; i++) {
            const start = positions[i].index;
            const end = i + 1 < positions.length ? positions[i + 1].index : input.length;
            const fullCall = input.slice(start, end);
            const lastParenIndex = fullCall.lastIndexOf(")");

            if (lastParenIndex !== -1) {
                const sliced = fullCall.slice(0, lastParenIndex); // 마지막 ) 제거
                const argsPart = sliced.slice(sliced.indexOf("(") + 1);
                const args = argsPart.match(/("[^"]*"|\{.*\}|[0-9]+)/g)?.map(s => s.trim());
                if(!args) continue
                A.push({
                    type: positions[i].name,
                    param: args,
                    index: positions[i].index,
                    length: end - start
                });
            }
        }
    });
    return A;
}

/**
 * 테이블 편집 문자열이 변경되었는지 확인
 * @param {Chat} chat 단일 채팅 객체
 * @param {string[]} matches 새로운 매치 객체
 * @returns
 */
function isTableEditStrChanged(chat, matches) {
    if (chat.tableEditMatches != null && chat.tableEditMatches.join('') === matches.join('')) {
        return false
    }
    chat.tableEditMatches = matches
    return true
}

/**
 * 테이블의 모든 빈 행 제거
 */
function clearEmpty() {
    DERIVED.any.waitingTable.forEach(table => {
        table.clearEmpty()
    })
}



/**
 * 텍스트 내의 테이블 편집 이벤트 처리
 * @param {Chat} chat 단일 채팅 객체
 * @param {number} mesIndex 수정된 메시지 인덱스
 * @param {boolean} ignoreCheck 중복 검사를 건너뛸지 여부
 * @returns
 */
export function handleEditStrInMessage(chat, mesIndex = -1, ignoreCheck = false) {
    parseTableEditTag(chat, mesIndex, ignoreCheck)
    updateSystemMessageTableStatus();   // 새로운 코드, 테이블 데이터 상태를 시스템 메시지에 업데이트
    //executeTableEditTag(chat, mesIndex)
}

/**
 * 응답 중의 테이블 편집 태그 파싱
 * @param {*} piece 단일 채팅 객체
 * @param {number} mesIndex 수정된 메시지 인덱스
 * @param {boolean} ignoreCheck 중복 검사를 건너뛸지 여부
 */
export function parseTableEditTag(piece, mesIndex = -1, ignoreCheck = false) {
    const { matches } = getTableEditTag(piece.mes)
    if (!ignoreCheck && !isTableEditStrChanged(piece, matches)) return false
    const tableEditActions = handleTableEditTag(matches)
    tableEditActions.forEach((action, index) => tableEditActions[index].action = classifyParams(formatParams(action.param)))
    console.log("파싱된 테이블 편집 명령", tableEditActions)

    // 이전 테이블 데이터 가져오기
    const { piece: prePiece } = mesIndex === -1 ? BASE.getLastSheetsPiece(1) : BASE.getLastSheetsPiece(mesIndex - 1, 1000, false)
    const sheets = BASE.hashSheetsToSheets(prePiece.hash_sheets).filter(sheet => sheet.enable)
    console.log("명령 실행 시 정보", sheets)
    for (const EditAction of sortActions(tableEditActions)) {
        executeAction(EditAction, sheets)
    }
    sheets.forEach(sheet => sheet.save(piece, true))
    console.log("채팅 템플릿:", BASE.sheetsData.context)
    console.log("가져온 테이블 데이터", prePiece)
    console.log("테스트 전체 chat", USER.getContext().chat)
    return true
}

/**
 * 편집 명령 문자열을 통해 직접 작업 실행
 * @param {string[]} matches 편집 명령 문자열
 */
export function executeTableEditActions(matches, referencePiece) {
    const tableEditActions = handleTableEditTag(matches)
    tableEditActions.forEach((action, index) => tableEditActions[index].action = classifyParams(formatParams(action.param)))
    console.log("파싱된 테이블 편집 명령", tableEditActions)

    // 핵심 수정: 전달받은 referencePiece.hash_sheets를 더 이상 신뢰하지 않고, BASE에서 직접 현재 활성화된 유일한 Sheet 인스턴스를 가져옴.
    const sheets = BASE.getChatSheets().filter(sheet => sheet.enable)
    if (!sheets || sheets.length === 0) {
        console.error("executeTableEditActions: 활성화된 테이블 인스턴스를 찾을 수 없음, 작업 중단.");
        return false;
    }

    console.log("명령 실행 시 정보 (BASE.getChatSheets에서)", sheets)
    for (const EditAction of sortActions(tableEditActions)) {
        executeAction(EditAction, sheets)
    }
    
    // 핵심 수정: 수정 사항이 현재 최신 채팅 조각에 저장되도록 확인.
    const { piece: currentPiece } = USER.getChatPiece();
    if (!currentPiece) {
        console.error("executeTableEditActions: 현재 채팅 조각을 가져올 수 없음, 저장 작업 실패.");
        return false;
    }
    sheets.forEach(sheet => sheet.save(currentPiece, true))

    console.log("채팅 템플릿:", BASE.sheetsData.context)
    console.log("테스트 전체 chat", USER.getContext().chat)
    return true // true 반환은 성공을 의미
}

/**
 * 단일 action 명령 실행
 */
function executeAction(EditAction, sheets) {
    const action = EditAction.action
    const sheet = sheets[action.tableIndex]
    if (!sheet) {
        console.error("테이블이 존재하지 않음, 편집 작업 실행 불가", EditAction);
        return -1;
    }

    // 모든 작업 전에 action.data를 한 번 깊이 정리
    if (action.data) {
        action.data = fixUnescapedSingleQuotes(action.data);
    }
    switch (EditAction.type) {
        case 'update':
            // 업데이트 작업 실행
            const rowIndex = action.rowIndex ? parseInt(action.rowIndex):0
            if(rowIndex >= sheet.getRowCount()-1) return executeAction({...EditAction, type:'insert'}, sheets)
            if(!action?.data) return
            Object.entries(action.data).forEach(([key, value]) => {
                const cell = sheet.findCellByPosition(rowIndex + 1, parseInt(key) + 1)
                if (!cell) return -1
                cell.newAction(cell.CellAction.editCell, { value }, false)
            })
            break
        case 'insert': {
            // 삽입 작업 실행
            const cell = sheet.findCellByPosition(sheet.getRowCount() - 1, 0)
            if (!cell) return -1
            cell.newAction(cell.CellAction.insertDownRow, {}, false)
            const lastestRow = sheet.getRowCount() - 1
            const cells = sheet.getCellsByRowIndex(lastestRow)
            if(!cells || !action.data) return
            cells.forEach((cell, index) => {
                if (index === 0) return 
                cell.data.value = action.data[index - 1]
            })
        }
            break
        case 'delete':
            // 삭제 작업 실행
            const deleteRow = parseInt(action.rowIndex) + 1
            const cell = sheet.findCellByPosition(deleteRow, 0)
            if (!cell) return -1
            cell.newAction(cell.CellAction.deleteSelfRow, {}, false)
            break
    }
    console.log("테이블 편집 작업 실행", EditAction)
    return 1
}


/**
 * actions 정렬
 * @param {Object[]} actions 정렬할 actions
 * @returns 정렬된 actions
 */
function sortActions(actions) {
    // 정렬 우선순위 정의
    const priority = {
        update: 0,
        insert: 1,
        delete: 2
    };
    return actions.sort((a, b) => (priority[a.type] === 2 && priority[b.type] === 2) ? (b.action.rowIndex - a.action.rowIndex) : (priority[a.type] - priority[b.type]));
}

/**
 * 매개변수 포맷팅
 * @description 매개변수 배열의 문자열을 숫자나 객체로 변환
 * @param {string[]} paramArray
 * @returns
 */
function formatParams(paramArray) {
    return paramArray.map(item => {
        const trimmed = item.trim();
        if (!isNaN(trimmed) && trimmed !== "") {
            return Number(trimmed);
        }
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            return parseLooseDict(trimmed);
        }

        // 기타 경우는 모두 문자열 반환
        return trimmed;
    });
}

/**
 * 매개변수 분류
 * @param {string[]} param 매개변수
 * @returns {Object} 분류된 매개변수 객체
 */
function classifyParams(param) {
    const action = {};
    for (const key in param) {
        if (typeof param[key] === 'number') {
            if (key === '0') action.tableIndex = param[key]
            else if (key === '1') action.rowIndex = param[key]
        } else if (typeof param[key] === 'object') {
            action.data = param[key]
        }
    }
    return action
}

/**
 * 응답 실행 중 편집 태크
 * @param {Chat} chat 단일 채팅 대상
 * @param {number} mesIndex 수정된 메시지 인덱스
 */
function executeTableEditTag(chat, mesIndex = -1, ignoreCheck = false) {

    // 최신 메시지가 아닌 경우, 다음 표를 업데이트
    if (mesIndex !== -1) {
        const { index, chat: nextChat } = findNextChatWhitTableData(mesIndex)
        if (index !== -1) handleEditStrInMessage(nextChat, index, true)
    }
}

/**
 * 드라이 런으로 삽입 action의 삽입 위치와 테이블 삽입 업데이트 내용 가져오기
 */
function dryRunExecuteTableEditTag() {
    // TODO 새로운 Sheet 시스템을 사용하여 테이블 편집 처리
}

/**
 * 생성된 작업 함수 문자열 가져오기
 * @returns 생성된 작업 함수 문자열
 */
export function getTableEditActionsStr() {
    const tableEditActionsStr = DERIVED.any.tableEditActions.filter(action => action.able && action.type !== 'Comment').map(tableEditAction => tableEditAction.format()).join('\n')
    return "\n<!--\n" + (tableEditActionsStr === '' ? '' : (tableEditActionsStr + '\n')) + '-->\n'
}

/**
 * 채팅의 TableEdit 태그 내 내용 교체
 * @param {*} chat 채팅 객체
 */
export function replaceTableEditTag(chat, newContent) {
    // mes 처리
    if (/<tableEdit>.*?<\/tableEdit>/gs.test(chat.mes)) {
        chat.mes = chat.mes.replace(/<tableEdit>(.*?)<\/tableEdit>/gs, `<tableEdit>${newContent}</tableEdit>`);
    } else {
        chat.mes += `\n<tableEdit>${newContent}</tableEdit>`;
    }
    // swipes 처리
    if (chat.swipes != null && chat.swipe_id != null)
        if (/<tableEdit>.*?<\/tableEdit>/gs.test(chat.swipes[chat.swipe_id])) {
            chat.swipes[chat.swipe_id] = chat.swipes[chat.swipe_id].replace(/<tableEdit>(.*?)<\/tableEdit>/gs, `<tableEdit>\n${newContent}\n</tableEdit>`);
        } else {
            chat.swipes[chat.swipe_id] += `\n<tableEdit>${newContent}</tableEdit>`;
        }
    USER.getContext().saveChat();
}

/**
 * 설정에서 주입 역할 읽기
 * @returns 주입 역할
 */
function getMesRole() {
    switch (USER.tableBaseSetting.injection_mode) {
        case 'deep_system':
            return 'system'
        case 'deep_user':
            return 'user'
        case 'deep_assistant':
            return 'assistant'
    }
}

/**
 * 테이블 전체 프롬프트 주입
 * @param {*} eventData
 * @returns
 */
async function onChatCompletionPromptReady(eventData) {
    try {
        // 단계별 테이블 작성 모드 우선 처리
        if (USER.tableBaseSetting.step_by_step === true) {
            // 플러그인과 AI 테이블 읽기 기능이 활성화된 경우에만 주입
            if (USER.tableBaseSetting.isExtensionAble === true && USER.tableBaseSetting.isAiReadTable === true) {
                const tableData = getTablePrompt(eventData, true); // 순수 데이터 가져오기
                if (tableData) { // 주입할 내용이 있는지 확인
                    const finalPrompt = `다음은 테이블로 기록된 현재 시나리오 정보와 히스토리 정보입니다. 이를 참고하여 생각해야 합니다:\n${tableData}`;
                    if (USER.tableBaseSetting.deep === 0) {
                        eventData.chat.push({ role: getMesRole(), content: finalPrompt });
                    } else {
                        eventData.chat.splice(-USER.tableBaseSetting.deep, 0, { role: getMesRole(), content: finalPrompt });
                    }
                    console.log("단계별 테이블 작성 모드: 읽기 전용 테이블 데이터 주입", eventData.chat);
                }
            }
            return; // 단계별 모드 처리 완료 후 직접 종료, 후속 일반 주입 실행하지 않음
        }

        // 일반 모드의 주입 로직
        if (eventData.dryRun === true ||
            USER.tableBaseSetting.isExtensionAble === false ||
            USER.tableBaseSetting.isAiReadTable === false ||
            USER.tableBaseSetting.injection_mode === "injection_off") {
            return;
        }

        console.log("프롬프트 생성 전", USER.getContext().chat)
        const promptContent = initTableData(eventData)
        if (USER.tableBaseSetting.deep === 0)
            eventData.chat.push({ role: getMesRole(), content: promptContent })
        else
            eventData.chat.splice(-USER.tableBaseSetting.deep, 0, { role: getMesRole(), content: promptContent })

        updateSheetsView()
    } catch (error) {
        EDITOR.error(`메모리 플러그인: 테이블 데이터 주입 실패\n원인:`,error.message, error);
    }
    console.log("테이블 전체 프롬프트 주입", eventData.chat)
}

/**
  * 매크로 프롬프트 가져오기
  */
function getMacroPrompt() {
    try {
        if (USER.tableBaseSetting.isExtensionAble === false || USER.tableBaseSetting.isAiReadTable === false) return ""
        if (USER.tableBaseSetting.step_by_step === true) {
            const promptContent = replaceUserTag(getTablePrompt(undefined, true))
            return `다음은 테이블로 기록된 현재 시나리오 정보와 히스토리 정보입니다. 이를 참고하여 생각해야 합니다:\n${promptContent}`
        }
        const promptContent = initTableData()
        return promptContent
    }catch (error) {
        EDITOR.error(`메모리 플러그인: 매크로 프롬프트 주입 실패\n원인:`, error.message, error);
        return ""
    }
}

/**
  * 매크로 테이블 프롬프트 가져오기
  */
function getMacroTablePrompt() {
    try {
        if (USER.tableBaseSetting.isExtensionAble === false || USER.tableBaseSetting.isAiReadTable === false) return ""
        if(USER.tableBaseSetting.step_by_step === true){
            const promptContent = replaceUserTag(getTablePrompt(undefined, true))
            return promptContent
        }
        const promptContent = replaceUserTag(getTablePrompt())
        return promptContent
    }catch (error) {
        EDITOR.error(`메모리 플러그인: 매크로 프롬프트 주입 실패\n원인:`, error.message, error);
        return ""
    }
}

/**
 * 편집 명령 양 끝의 공백과 주석 태그 제거
 * @param {string} str 입력된 편집 명령 문자열
 * @returns
 */
function trimString(str) {
    const str1 = str.trim()
    if (!str1.startsWith("<!--") || !str1.endsWith("-->")) {
        editErrorInfo.forgotCommentTag = true
    }
    return str1
        .replace(/^\s*<!--|-->?\s*$/g, "")
        .trim()
}

/**
 * 테이블의 tableEdit 태그 내 내용 가져오기
 * @param {string} mes 메시지 본문 문자열
 * @returns {matches} 매칭된 내용 배열
 */

export function getTableEditTag(mes) {
    const regex = /<tableEdit>(.*?)<\/tableEdit>/gs;
    const matches = [];
    let match;
    while ((match = regex.exec(mes)) !== null) {
        matches.push(match[1]);
    }
    const updatedText = mes.replace(regex, "");
    return { matches }
}

/**
 * 메시지 편집 시 트리거
 * @param this_edit_mes_id 이 메시지의 ID
 */
async function onMessageEdited(this_edit_mes_id) {
    if (USER.tableBaseSetting.isExtensionAble === false || USER.tableBaseSetting.step_by_step === true) return
    const chat = USER.getContext().chat[this_edit_mes_id]
    if (chat.is_user === true || USER.tableBaseSetting.isAiWriteTable === false) return
    try {
        handleEditStrInMessage(chat, parseInt(this_edit_mes_id))
    } catch (error) {
        EDITOR.error("메모리 플러그인: 테이블 편집 실패\n원인:", error.message, error)
    }
    updateSheetsView()
}

/**
 * 메시지 수신 시 트리거
 * @param {number} chat_id 이 메시지의 ID
 */
async function onMessageReceived(chat_id) {
    if (USER.tableBaseSetting.isExtensionAble === false) return
    if (USER.tableBaseSetting.step_by_step === true && USER.getContext().chat.length > 2) {
        TableTwoStepSummary("auto");  // await를 사용하지 마세요. 메인 프로세스 블로킹으로 인한 연쇄 버그를 방지하기 위함.
    } else {
        if (USER.tableBaseSetting.isAiWriteTable === false) return
        const chat = USER.getContext().chat[chat_id];
        console.log("메시지 수신", chat_id)
        try {
            handleEditStrInMessage(chat)
        } catch (error) {
            EDITOR.error("메모리 플러그인: 테이블 자동 변경 실패\n원인:", error.message, error)
        }
    }

    updateSheetsView()
}

/**
 * 문자열의 모든 {{GET::...}} 매크로 파싱
 * @param {string} text - 파싱할 텍스트
 * @returns {string} - 매크로를 파싱하고 교체한 후의 텍스트
 */
function resolveTableMacros(text) {
    if (typeof text !== 'string' || !text.includes('{{GET::')) {
        return text;
    }

    return text.replace(/{{GET::\s*([^:]+?)\s*:\s*([A-Z]+\d+)\s*}}/g, (match, tableName, cellAddress) => {
        const sheets = BASE.getChatSheets();
        const targetTable = sheets.find(t => t.name.trim() === tableName.trim());

        if (!targetTable) {
            return `<span style="color: red">[GET: 테이블 "${tableName}"을 찾을 수 없음]</span>`;
        }

        try {
            const cell = targetTable.getCellFromAddress(cellAddress);
            const cellValue = cell ? cell.data.value : undefined;
            return cellValue !== undefined ? cellValue : `<span style="color: orange">[GET: "${tableName}"에서 셀 "${cellAddress}"을 찾을 수 없음]</span>`;
        } catch (error) {
            console.error(`Error resolving GET macro for ${tableName}:${cellAddress}`, error);
            return `<span style="color: red">[GET: 처리 중 오류]</span>`;
        }
    });
}

/**
 * 채팅 변경 시 트리거
 */
async function onChatChanged() {
    try {
        // 테이블 뷰 업데이트
        updateSheetsView();

        // 채팅 메시지에서 매크로 렌더링
        document.querySelectorAll('.mes_text').forEach(mes => {
            if (mes.dataset.macroProcessed) return;

            const originalHtml = mes.innerHTML;
            const newHtml = resolveTableMacros(originalHtml);

            if (originalHtml !== newHtml) {
                mes.innerHTML = newHtml;
                mes.dataset.macroProcessed = true;
            }
        });

    } catch (error) {
        EDITOR.error("메모리 플러그인: 채팅 변경 처리 실패\n원인:", error.message, error)
    }
}


/**
 * 스와이프 메시지 전환 이벤트
 */
async function onMessageSwiped(chat_id) {
    if (USER.tableBaseSetting.isExtensionAble === false || USER.tableBaseSetting.isAiWriteTable === false) return
    const chat = USER.getContext().chat[chat_id];
    console.log("스와이프 메시지 전환", chat)
    if (!chat.swipe_info[chat.swipe_id]) return
    try {
        handleEditStrInMessage(chat)
    } catch (error) {
        EDITOR.error("메모리 플러그인: swipe 전환 실패\n원인:", error.message, error)
    }

    updateSheetsView()
}

/**
 * 지정된 레이어 수의 테이블 복원
 */
export async function undoSheets(deep) {
    const {piece, deep:findDeep} = BASE.getLastSheetsPiece(deep)
    if(findDeep === -1) return 
    console.log("테이블 데이터 되돌리기", piece, findDeep)
    handleEditStrInMessage(piece, findDeep, true)
    updateSheetsView()
}

/**
 * 새로운 테이블 뷰 업데이트
 * @description 새로운 Sheet 시스템을 사용하여 테이블 뷰 업데이트
 * @returns {Promise<*[]>}
 */
async function updateSheetsView(mesId) {
    const task = new SYSTEM.taskTiming('openAppHeaderTableDrawer_task')
    try{
       // 테이블 뷰 새로고침
        console.log("========================================\n표 보기 업데이트")
        refreshTempView(true).then(() => task.log());
        console.log("========================================\n표 내용 보기 업데이트")
        BASE.refreshContextView(mesId).then(() => task.log());

        // 시스템 메시지의 테이블 상태 업데이트
        updateSystemMessageTableStatus(); 
    }catch (error) {
        EDITOR.error("메모리 플러그인: 테이블 보기 업데이트 실패\n원인:", error.message, error)
    }
}

/**
 * 打开테이블drawer
 */
export function openDrawer() {
    const drawer = $('#table_database_settings_drawer .drawer-toggle')
    if (isDrawerNewVersion()) {
        applicationFunctionManager.doNavbarIconClick.call(drawer)
    }else{
        return openAppHeaderTableDrawer()
    }
}

/**
 * 获取是新版还是旧版drawer
 */
export function isDrawerNewVersion() {
    return !!applicationFunctionManager.doNavbarIconClick
}

jQuery(async () => {
    // API 등록
    window.stMemoryEnhancement = {
        ext_getAllTables,
        ext_exportAllTablesAsJson,
    };

    // 버전 확인
    fetch("http://api.muyoo.com.cn/check-version", {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientVersion: VERSION, user: USER.getContext().name1 })
    }).then(res => res.json()).then(res => {
        if (res.success) {
            if (!res.isLatest) $("#tableUpdateTag").show()
            if (res.toastr) EDITOR.warning(res.toastrText)
            if (res.message) $("#table_message_tip").html(res.message)
        }
    })

    $('.extraMesButtons').append('<div title="표 보기" class="mes_button open_table_by_id">표</div>');

    // 모바일과 PC 이벤트 분리
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        console.log("모바일")
        // 모바일 이벤트
    } else {
        console.log("PC")
        // PC 이벤트
        initTest();
    }

    // 각 부분의 루트 DOM 추가 시작
    // 테이블 편집 툴바 추가
    $('#translation_container').after(await SYSTEM.getTemplate('index'));
    // 상단 테이블 관리 도구 팝업 추가
    $('#extensions-settings-button').after(await SYSTEM.getTemplate('appHeaderTableDrawer'));

    // 애플리케이션 시작 시 설정 로드
    loadSettings();

    // 표 팝업 창
    $(document).on('click', '.open_table_by_id', function () {
        const messageId = parseInt($(this).closest('.mes').attr('mesid'))
        if (USER.getContext().chat[messageId].is_user === true) {
            toastr.warning('사용자 메시지는 표 편집을 지원하지 않습니다')
            return
        }
        BASE.refreshContextView(messageId)
        openDrawer()
    })

    // 注册宏
    USER.getContext().registerMacro("tablePrompt", () =>getMacroPrompt())
    USER.getContext().registerMacro("tableData", () =>getMacroTablePrompt())
    USER.getContext().registerMacro("GET_ALL_TABLES_JSON", () => {
        try {
            const jsonData = ext_exportAllTablesAsJson();
            if (Object.keys(jsonData).length === 0) {
                return "{}"; // 데이터가 없으면 빈 JSON 객체 반환
            }
            // 코드에서 직접 사용할 수 있도록 추가 포맷팅 없이 JSON 문자열 반환
            return JSON.stringify(jsonData);
        } catch (error) {
            console.error("GET_ALL_TABLES_JSON 매크로 실행 오류:", error);
            EDITOR.error("모든 표 데이터 내보내기 중 오류 발생","",error);
            return "{}"; // 오류 시 빈 JSON 객체 반환
        }
    });
   
    let doNavbarIconClick = undefined;
    try {
        // 동적 임포트, 함수가 존재하지 않는 경우에도 호환되도록 처리
        const module = await import('../../../../script.js');
        doNavbarIconClick = module.doNavbarIconClick;
    } catch (e) { }

    // 设置테이블编辑按钮
    console.log("표 편집 버튼 배치", applicationFunctionManager.doNavbarIconClick)
    if (isDrawerNewVersion()) {
        $('#table_database_settings_drawer .drawer-toggle').on('click', applicationFunctionManager.doNavbarIconClick);
    }else{
        $('#table_drawer_content').attr('data-slide-toggle', 'hidden').css('display', 'none');
        $('#table_database_settings_drawer .drawer-toggle').on('click', openAppHeaderTableDrawer);
    }
    // // 设置테이블编辑按钮
    // $(document).on('click', '.tableEditor_editButton', function () {
    //     let index = $(this).data('index'); // 현재 클릭된 인덱스 가져오기
    //     openTableSettingPopup(index);
    // })
    // 테이블 렌더링 스타일 설정 버튼 클릭
    $(document).on('click', '.tableEditor_renderButton', function () {
        openTableRendererPopup();
    })
    // 테이블 로그 보기 버튼 클릭
    $(document).on('click', '#table_debug_log_button', function () {
        openTableDebugLogPopup();
    })
    // 대화 데이터 테이블 팝업창
    $(document).on('click', '.open_table_by_id', function () {
        const messageId = $(this).closest('.mes').attr('mesid');
        initRefreshTypeSelector();
    })
    // 테이블 활성화 스위치 설정
    $(document).on('change', '.tableEditor_switch', function () {
        let index = $(this).data('index'); // 현재 클릭된 인덱스 가져오기
        const tableStructure = findTableStructureByIndex(index);
        tableStructure.enable = $(this).prop('checked');
    })

    initAppHeaderTableDrawer().then();  // 테이블 편집기 초기화
    functionToBeRegistered()    // 디버깅용 다양한 함수 등록

    executeTranslation(); // 번역 함수 실행

    // 메인 프로그램 이벤트 리스닝
    APP.eventSource.on(APP.event_types.MESSAGE_RECEIVED, onMessageReceived);
    APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
    APP.eventSource.on(APP.event_types.CHAT_CHANGED, onChatChanged);
    APP.eventSource.on(APP.event_types.MESSAGE_EDITED, onMessageEdited);
    APP.eventSource.on(APP.event_types.MESSAGE_SWIPED, onMessageSwiped);
    APP.eventSource.on(APP.event_types.MESSAGE_DELETED, onChatChanged);

    
    console.log("______________________메모리 플러그인: 로딩 완료______________________")
});