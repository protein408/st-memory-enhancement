import { BASE, DERIVED, EDITOR, SYSTEM, USER } from '../../core/manager.js';
import { updateSystemMessageTableStatus } from "../renderer/tablePushToChat.js";
import { findNextChatWhitTableData,undoSheets } from "../../index.js";
import { rebuildSheets } from "../runtime/absoluteRefresh.js";
import { openTableHistoryPopup } from "./tableHistory.js";
import { PopupMenu } from "../../components/popupMenu.js";
import { openTableStatisticsPopup } from "./tableStatistics.js";
import { openCellHistoryPopup } from "./cellHistory.js";
import { openSheetStyleRendererPopup } from "./sheetStyleEditor.js";

let tablePopup = null
let copyTableData = null
let selectedCell = null
let editModeSelectedRows = []
let viewSheetsContainer = null
let lastCellsHashSheet = null
const userTableEditInfo = {
    chatIndex: null,
    editAble: false,
    tables: null,
    tableIndex: null,
    rowIndex: null,
    colIndex: null,
}

/**
 * 复制테이블
 * @param {*} tables 所有테이블数据
 */
export async function copyTable() {
    copyTableData = JSON.stringify(getTableJson({type:'chatSheets', version: 1}))
    if(!copyTableData) return
    $('#table_drawer_icon').click()

    EDITOR.confirm(`표 데이터 복사 중 (#${SYSTEM.generateRandomString(4)})`, '취소', '현재 대화에 붙여넣기').then(async (r) => {
        if (r) {
            await pasteTable()
        }
        if ($('#table_drawer_icon').hasClass('closedIcon')) {
            $('#table_drawer_icon').click()
        }
    })
}

/**
 * 粘贴테이블
 * @param {number} mesId 需要粘贴到的消息id
 * @param {Element} viewSheetsContainer 표 컨테이너 DOM
 */
async function pasteTable() {
    if (USER.getContext().chat.length === 0) {
        EDITOR.error("표를 위한 최소한의 내용으로 AI가 한 개 이상의 메시지를 응답하도록 해주세요.")
        return
    }
    const confirmation = await EDITOR.callGenericPopup('붙여넣기는 기존 표 데이터를 모두 삭제합니다. 계속하시겠습니까?', EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "계속하기", cancelButton: "취소" });
    if (confirmation) {
        if (copyTableData) {
            const tables = JSON.parse(copyTableData)
            if(!tables.mate === 'chatSheets')  return EDITOR.error("가져오기 실패: 파일 형식이 올바르지 않습니다.")
            BASE.applyJsonToChatSheets(tables)
            await renderSheetsDOM()
            EDITOR.success('붙여넣기 성공')
        } else {
            EDITOR.error("붙여넣기 실패: 클립보드에 표 데이터가 없습니다.")
        }
    }
}

/**
 * 导入테이블
 * @param {number} mesId 需要导入테이블的消息id
 */
async function importTable(mesId, viewSheetsContainer) {
    if (mesId === -1) {
        EDITOR.error("표의 기본 내용으로 AI가 최소 한 개의 메시지를 응답하도록 해주세요.")
        return
    }

    // 1. 创建一个 input 元素，类型设置为 'file'，用于文件选择
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    // 设置 accept 属性，限制只能选择 JSON 文件，提高用户体验
    fileInput.accept = '.json';

    // 2. 添加事件监听器，监听文件选择的变化 (change 事件)
    fileInput.addEventListener('change', function (event) {
        // 获取用户选择的文件열表 (FileList 对象)
        const files = event.target.files;

        // 检查是否选择了文件
        if (files && files.length > 0) {
            // 获取用户选择的第一个文件 (这里假设只选择一个 JSON 文件)
            const file = files[0];

            // 3. 创建 FileReader 对象，用于读取文件内容
            const reader = new FileReader();

            // 4. 定义 FileReader 的 onload 事件处理函数
            // 当文件读取성공后，会触发 onload 事件
            reader.onload = async function (loadEvent) {
                const button = { text: '템플릿 및 데이터 가져오기', result: 3 }
                const popup = new EDITOR.Popup("가져올 부분을 선택해주세요.", EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "템플릿 및 데이터 가져오기", cancelButton: "취소"});
                const result = await popup.show()
                if (result) {
                        const tables = JSON.parse(loadEvent.target.result)
                        console.log("가져오기 내용", tables, tables.mate, !(tables.mate === 'chatSheets'))
                        if(!(tables.mate?.type === 'chatSheets'))  return EDITOR.error("가져오기 실패: 파일 형식이 올바르지 않습니다.", "가져오신 데이터가 표 데이터인지 확인해 주세요.")
                        if(result === 3)
                            BASE.applyJsonToChatSheets(tables, "data")
                        else
                            BASE.applyJsonToChatSheets(tables)
                        await renderSheetsDOM()
                        EDITOR.success('가져오기 성공')
                }
            };
            reader.readAsText(file, 'UTF-8'); // 建议指定 UTF-8 编码，确保中文等字符正常读取
        }
    });
    fileInput.click();
}

/**
 * 导出테이블
 * @param {Array} tables 所有테이블数据
 */
async function exportTable() {
    const jsonTables = getTableJson({type:'chatSheets', version: 1})
    if(!jsonTables) return
    const bom = '\uFEFF';
    const blob = new Blob([bom + JSON.stringify(jsonTables)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = 'table_data.json'; // 默认文件名
    document.body.appendChild(downloadLink); // 必须添加到 DOM 才能触发下载
    downloadLink.click();
    document.body.removeChild(downloadLink); // 下载完成后移除

    URL.revokeObjectURL(url); // 释放 URL 对象

    EDITOR.success('已导出');
}

/**
 * 获取테이블Json数据
 */
function getTableJson(mate) {
    if (!DERIVED.any.renderingSheets || DERIVED.any.renderingSheets.length === 0) {
        EDITOR.warning('현재 표에 데이터가 없어 내보낼 수 없습니다.');
        return;
    }
    const sheets = DERIVED.any.renderingSheets.filter(sheet => sheet.enable)
    // const csvTables = sheets.map(sheet => "SHEET-START" + sheet.uid + "\n" + sheet.getSheetCSV(false) + "SHEET-END").join('\n')
    const jsonTables = {}
    sheets.forEach(sheet => {
        jsonTables[sheet.uid] = sheet.getJson()
    })
    jsonTables.mate = mate
    return jsonTables
}

/**
 * 清空테이블
 * @param {number} mesId 표를 비우기 위한 메시지 ID 필요
 * @param {Element} viewSheetsContainer 표 컨테이너 DOM
 */
async function clearTable(mesId, viewSheetsContainer) {
    if (mesId === -1) return
    const confirmation = await EDITOR.callGenericPopup('현재 대화의 모든 표 데이터를 삭제하고 기록을 초기화합니다. 이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?', EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "계속하기", cancelButton: "취소" });
    if (confirmation) {
        await USER.getContext().chat.forEach((piece => {
            if (piece.hash_sheets) {
                delete piece.hash_sheets
            }
            if (piece.dataTable) delete piece.dataTable
        }))
        setTimeout(() => {
            USER.saveSettings()
            USER.saveChat();
            BASE.refreshContextView()
            EDITOR.success("표 데이터 삭제 성공")
            console.log("已清除테이블数据")
        }, 100)
    }
}

/**
 * 设置테이블编辑Tips
 * @param {Element} tableEditTips 테이블编辑提示DOM
 */
function setTableEditTips(tableEditTips) {
    /* if (!tableEditTips || tableEditTips.length === 0) {
        console.error('tableEditTips is null or empty jQuery object');
        return;
    }
    const tips = $(tableEditTips); // 确保 tableEditTips 是 jQuery 对象
    tips.empty();
    if (USER.tableBaseSetting.isExtensionAble === false) {
        tips.append('目前插件已关闭，将不会要求AI更新테이블。');
        tips.css("color", "rgb(211 39 39)");
    } else if (userTableEditInfo.editAble) {
        tips.append('点击单元格选择编辑 작업。绿色单元格为本轮삽입，蓝色单元格为本轮修改。');
        tips.css("color", "lightgreen");
    } else {
        tips.append('此테이블为中间테이블，为避免混乱，不可被编辑和粘贴。你可以打开最新消息的테이블进行编辑');
        tips.css("color", "lightyellow");
    } */
}

async function cellDataEdit(cell) {
    const result = await EDITOR.callGenericPopup("셀 편집", EDITOR.POPUP_TYPE.INPUT, cell.data.value, { rows: 3 })
    if (result) {
        cell.editCellData({ value: result })
        refreshContextView();
        if(cell.type === cell.CellType.column_header) BASE.refreshTempView(true)
    }
}


async function columnDataEdit(cell) {
    const columnEditor = `
<div class="column-editor">
    <div class="column-editor-header">
        <h3>열 데이터 편집</h3>
    </div>
    <div class="column-editor-body">
        <div class="column-editor-content">
            <label for="column-editor-input">열 테이터:</label>
            <textarea id="column-editor-input" rows="5"></textarea>
        </div>
    </div>
</div>
`
    const columnCellDataPopup = new EDITOR.Popup(columnEditor, EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "수정 적용", cancelButton: "취소" });
    const historyContainer = $(columnCellDataPopup.dlg)[0];

    await columnCellDataPopup.show();

    if (columnCellDataPopup.result) {
        // cell.editCellData({ value: result })
        refreshContextView();
    }
}

function batchEditMode(cell) {
    DERIVED.any.batchEditMode = true;
    DERIVED.any.batchEditModeSheet = cell.parent;
    EDITOR.confirm(`편집 중 #${cell.parent.name} 의 행`, '취소', '완료').then((r) => {
        DERIVED.any.batchEditMode = false;
        DERIVED.any.batchEditModeSheet = null;
        renderSheetsDOM();
    })
    renderSheetsDOM();
}

// 新的事件处理函数
export function cellClickEditModeEvent(cell) {
    cell.element.style.cursor = 'pointer'
    if (cell.type === cell.CellType.row_header) {
        cell.element.textContent = ''

        // 在 cell.element 中添加三个 div，一个用于显示排序，一个用于显示锁定按钮，一个用于显示删除按钮
        const containerDiv = $(`<div class="flex-container" style="display: flex; flex-direction: row; justify-content: space-between; width: 100%;"></div>`)
        const rightDiv = $(`<div class="flex-container" style="margin-right: 3px"></div>`)
        const indexDiv = $(`<span class="menu_button_icon interactable" style="margin: 0; padding: 0 6px; cursor: move; color: var(--SmartThemeBodyColor)">${cell.position[0]}</span>`)
        const lockDiv = $(`<div><i class="menu_button menu_button_icon interactable fa fa-lock" style="margin: 0; border: none; color: var(--SmartThemeEmColor)"></i></div>`)
        const deleteDiv = $(`<div><i class="menu_button menu_button_icon interactable fa fa-xmark redWarningBG" style="margin: 0; border: none; color: var(--SmartThemeEmColor)"></i></div>`)

        $(lockDiv).on('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (cell._pre_deletion) return

            cell.parent.hashSheet.forEach(row => {
                if (row[0] === cell.uid) {
                    row.forEach((hash) => {
                        const target = cell.parent.cells.get(hash)
                        target.locked = !target.locked
                        target.element.style.backgroundColor = target.locked ? '#00ff0022' : ''
                    })
                }
            })
        })
        $(deleteDiv).on('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            handleAction(cell, cell.CellAction.deleteSelfRow)
            //if (cell.locked) return

            /* cell.parent.hashSheet.forEach(row => {
                if (row[0] === cell.uid) {
                    row.forEach((hash) => {
                        const target = cell.parent.cells.get(hash)
                        target._pre_deletion = !target._pre_deletion
                        target.element.style.backgroundColor = target._pre_deletion ? '#ff000044' : ''
                    })
                }
            }) */
        })

        $(rightDiv).append(deleteDiv)
        $(containerDiv).append(indexDiv).append(rightDiv)
        $(cell.element).append(containerDiv)

    } else if (cell.type === cell.CellType.cell) {
        cell.element.style.cursor = 'text'
        cell.element.contentEditable = true
        cell.element.focus()
        cell.element.addEventListener('blur', (e) => {
            e.stopPropagation();
            e.preventDefault();
            cell.data.value = cell.element.textContent.trim()
        })
    }

    cell.on('click', async (event) => {
        event.stopPropagation();
        event.preventDefault();
    })
}

async function confirmAction(event, text = '이 작업을 계속하시겠습니까?') {
    const confirmation = new EDITOR.Popup(text, EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "계속하기", cancelButton: "취소" });

    await confirmation.show();
    if (!confirmation.result) return { filterData: null, confirmation: false };
    event()
}

/**
 * 单元格高亮
 */
export function cellHighlight(sheet) {
    const lastHashSheet = lastCellsHashSheet[sheet.uid] || []
    if ((sheet.hashSheet.length < 2) && (lastHashSheet.length < 2)) return;    //테이블内容为空的时候不执行后续函数,提高健壮性
    const hashSheetFlat = sheet.hashSheet.flat()
    const lastHashSheetFlat = lastHashSheet.flat()
    let deleteRow = []
    lastHashSheet.forEach((row, index) => {
        if (!hashSheetFlat.includes(row[0])) {
            deleteRow.push(row[0])
            sheet.hashSheet.splice(index,0,lastHashSheet[index])
        }
    })

    const changeSheet = sheet.hashSheet.map((row) => {
        const isNewRow = !lastHashSheetFlat.includes(row[0])
        const isDeletedRow = deleteRow.includes(row[0])
        return row.map((hash) => {
            if (isNewRow) return { hash, type: "newRow" }
            if (isDeletedRow) return { hash, type: "deletedRow" }
            if (!lastHashSheetFlat.includes(hash)) return { hash, type: "update" }
            return { hash, type: "keep" }
        })
    })
    changeSheet.forEach((row, index) => {
        if (index === 0)
            return
        let isKeepAll = true
        row.forEach((cell) => {
            let sheetCell = sheet.cells.get(cell.hash)
            const cellElement = sheetCell.element
            if (cell.type === "newRow") {
                cellElement.classList.add('insert-item')
                isKeepAll = false
            } else if (cell.type === "update") {
                cellElement.classList.add('update-item')
                isKeepAll = false
            } else if (cell.type === "deletedRow") {
                sheetCell.isDeleted = true
                cellElement.classList.add('delete-item')
                isKeepAll = false
            } else if (sheetCell.isDeleted === true) {
                cellElement.classList.add('delete-item')
                isKeepAll = false
            } else {
                cellElement.classList.add('keep-item')
            }
        })
        if (isKeepAll) {
            row.forEach((cell) => {
                const cellElement = sheet.cells.get(cell.hash).element
                cellElement.classList.add('keep-all-item')
            })
        }
    })
}

async function cellHistoryView(cell) {
    await openCellHistoryPopup(cell)
}

/**
 * 사용자 정의 표 스타일事件
 * @param {*} cell
 */
async function customSheetStyle(cell) {
    await openSheetStyleRendererPopup(cell.parent)
    await refreshContextView();
}

function cellClickEvent(cell) {
    cell.element.style.cursor = 'pointer'

    // 判断是否需要根据历史数据进行高亮
    /* const lastCellUid = lastCellsHashSheet.has(cell.uid)
    if (!lastCellUid) {
        cell.element.style.backgroundColor = '#00ff0011'
    }
    else if (cell.parent.cells.get(lastCellUid).data.value !== cell.data.value) {
        cell.element.style.backgroundColor = '#0000ff11'
    } */

    cell.on('click', async (event) => {
        event.stopPropagation();
        event.preventDefault();

        // 重新获取hash
        BASE.getLastestSheets()

        if (cell.parent.currentPopupMenu) {
            cell.parent.currentPopupMenu.destroy();
            cell.parent.currentPopupMenu = null;
        }
        cell.parent.currentPopupMenu = new PopupMenu();

        const menu = cell.parent.currentPopupMenu;
        const [rowIndex, colIndex] = cell.position;
        const sheetType = cell.parent.type;

        if (rowIndex === 0 && colIndex === 0) {
            menu.add('<i class="fa-solid fa-bars-staggered"></i> 일괄 행 편집', () => batchEditMode(cell));
            menu.add('<i class="fa fa-arrow-right"></i> 오른쪽에 열 삽입', () => handleAction(cell, cell.CellAction.insertRightColumn));
            menu.add('<i class="fa fa-arrow-down"></i> 아래에 행 삽입', () => handleAction(cell, cell.CellAction.insertDownRow));
            menu.add('<i class="fa-solid fa-wand-magic-sparkles"></i> 사용자 정의 표 스타일', async () => customSheetStyle(cell));
        } else if (colIndex === 0) {
            menu.add('<i class="fa-solid fa-bars-staggered"></i> 일괄 행 편집', () => batchEditMode(cell));
            menu.add('<i class="fa fa-arrow-up"></i> 위에 행 삽입', () => handleAction(cell, cell.CellAction.insertUpRow));
            menu.add('<i class="fa fa-arrow-down"></i> 아래에 행 삽입', () => handleAction(cell, cell.CellAction.insertDownRow));
            menu.add('<i class="fa fa-trash-alt"></i> 행 삭제', () => handleAction(cell, cell.CellAction.deleteSelfRow), menu.ItemType.warning)
        } else if (rowIndex === 0) {
            menu.add('<i class="fa fa-i-cursor"></i> 해당 열 편집', async () => await cellDataEdit(cell));
            menu.add('<i class="fa fa-arrow-left"></i> 왼쪽에 열 삽입', () => handleAction(cell, cell.CellAction.insertLeftColumn));
            menu.add('<i class="fa fa-arrow-right"></i> 오른쪽에 열 삽입', () => handleAction(cell, cell.CellAction.insertRightColumn));
            menu.add('<i class="fa fa-trash-alt"></i> 열 삭제', () => confirmAction(() => { handleAction(cell, cell.CellAction.deleteSelfColumn) }, '열을 삭제하시겠습니까？'), menu.ItemType.warning);
        } else {
            menu.add('<i class="fa fa-i-cursor"></i> 해당 셀 편집', async () => await cellDataEdit(cell));
            menu.add('<i class="fa-solid fa-clock-rotate-left"></i> 셀 기록', async () => await cellHistoryView(cell));
        }

        // 设置弹出菜单后的一些非功能性派生 작업，这里必须使用setTimeout，否则会导致菜单无法正常显示
        setTimeout(() => {

        }, 0)

        const element = event.target

        // 备份当前cell的style，以便在菜单关闭时恢复
        const style = element.style.cssText;

        // 获取单元格位置
        const rect = element.getBoundingClientRect();
        const tableRect = viewSheetsContainer.getBoundingClientRect();

        // 计算菜单位置（相对于테이블容器）
        const menuLeft = rect.left - tableRect.left;
        const menuTop = rect.bottom - tableRect.top;
        const menuElement = menu.renderMenu();
        $(viewSheetsContainer).append(menuElement);

        // 高亮cell
        element.style.backgroundColor = 'var(--SmartThemeUserMesBlurTintColor)';
        element.style.color = 'var(--SmartThemeQuoteColor)';
        element.style.outline = '1px solid var(--SmartThemeQuoteColor)';
        element.style.zIndex = '999';

        menu.show(menuLeft, menuTop).then(() => {
            element.style.cssText = style;
        })
        menu.frameUpdate((menu) => {
            // 重新定位菜单
            const rect = element.getBoundingClientRect();
            const tableRect = viewSheetsContainer.getBoundingClientRect();

            // 计算菜单位置（相对于테이블容器）
            const menuLeft = rect.left - tableRect.left;
            const menuTop = rect.bottom - tableRect.top;
            menu.popupContainer.style.left = `${menuLeft}px`;
            menu.popupContainer.style.top = `${menuTop + 3}px`;
        })
    })
    cell.on('', () => {
        console.log('cell发生了改变:', cell)
    })
}

function handleAction(cell, action) {
    cell.newAction(action)
    refreshContextView();
    if(cell.type === cell.CellType.column_header) BASE.refreshTempView(true)
}

export async function renderEditableSheetsDOM(_sheets, _viewSheetsContainer, _cellClickEvent = cellClickEvent) {
    for (let [index, sheet] of _sheets.entries()) {
        if (!sheet.enable) continue
        const instance = sheet
        console.log("渲染：", instance)
        const sheetContainer = document.createElement('div')
        const sheetTitleText = document.createElement('h3')
        sheetContainer.style.overflowX = 'none'
        sheetContainer.style.overflowY = 'auto'
        sheetTitleText.innerText = `#${index} ${sheet.name}`

        let sheetElement = null

        if (DERIVED.any.batchEditMode === true) {
            if (DERIVED.any.batchEditModeSheet?.name === instance.name) {
                sheetElement = await instance.renderSheet(cellClickEditModeEvent)
            } else {
                sheetElement = await instance.renderSheet((cell) => {
                    cell.element.style.cursor = 'default'
                })
                sheetElement.style.cursor = 'default'
                sheetElement.style.opacity = '0.5'
                sheetTitleText.style.opacity = '0.5'
            }
        } else {
            sheetElement = await instance.renderSheet(_cellClickEvent)
        }
        cellHighlight(instance)
        console.log("渲染테이블：", sheetElement)
        $(sheetContainer).append(sheetElement)

        $(_viewSheetsContainer).append(sheetTitleText)
        $(_viewSheetsContainer).append(sheetContainer)
        $(_viewSheetsContainer).append(`<hr>`)
    }
}

/**
 * 恢复테이블
 * @param {number} mesId 표를 비우기 위한 메시지 ID 필요
 * @param {Element} tableContainer 표 컨테이너 DOM
 */
async function undoTable(mesId, tableContainer) {
    if (mesId === -1) return
    //const button = { text: '撤销10轮', result: 3 }
    const popup = new EDITOR.Popup("지정된 회차 내의 모든 수동 수정 및 재정리 데이터를 취소하고, 표를 복원합니다.", EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "이번 회차 취소", cancelButton: "취소" });
    const result = await popup.show()
    if (result) {
        await undoSheets(0)
        EDITOR.success('복원 성공')
    }
}


async function renderSheetsDOM() {
    const task = new SYSTEM.taskTiming('renderSheetsDOM_task')

    updateSystemMessageTableStatus();
    task.log()
    const { piece, deep } = BASE.getLastSheetsPiece();
    if (!piece || !piece.hash_sheets) return;

    const sheets = BASE.hashSheetsToSheets(piece.hash_sheets);
    sheets.forEach((sheet) => {
        sheet.hashSheet = sheet.hashSheet.filter((row) => {
            return (sheet.cells.get(row[0]).isDeleted !== true);
        })
        sheet.cells.forEach((cell) => {
            cell.isDeleted = false;
        })
    })
    console.log('renderSheetsDOM:', piece, sheets)
    DERIVED.any.renderingSheets = sheets
    task.log()
    // 用于记录上一次的hash_sheets，渲染时根据上一次的hash_sheets进行高亮
    lastCellsHashSheet = BASE.getLastSheetsPiece(deep - 1, 3, false)?.piece.hash_sheets;
    // console.log("找到的diff前项", lastCellsHashSheet)
    if (lastCellsHashSheet) {
        lastCellsHashSheet = BASE.copyHashSheets(lastCellsHashSheet)
        //for (const sheetUid in lastCellsHashSheet) {
        //    lastCellsHashSheet[sheetUid] = lastCellsHashSheet[sheetUid].flat()
        //}
    }
    task.log()
    $(viewSheetsContainer).empty()
    viewSheetsContainer.style.paddingBottom = '150px'
    renderEditableSheetsDOM(sheets, viewSheetsContainer)
    task.log()
}

let initializedTableView = null
async function initTableView(mesId) {
    initializedTableView = $(await SYSTEM.getTemplate('manager')).get(0);
    viewSheetsContainer = initializedTableView.querySelector('#tableContainer');

    // setTableEditTips($(initializedTableView).find('#tableEditTips'));    // 确保在 table_manager_container 存在的情况下查找 tableEditTips

    // 设置编辑提示
    // 点击打开查看테이블数据统计
    $(document).on('click', '#table_data_statistics_button', function () {
        EDITOR.tryBlock(openTableStatisticsPopup, "표 통계 열기 실패")
    })
    // 点击打开查看테이블历史按钮
    $(document).on('click', '#dataTable_history_button', function () {
        EDITOR.tryBlock(openTableHistoryPopup, "표 기록 열기 실패")
    })
    // 点击清空테이블按钮
    $(document).on('click', '#clear_table_button', function () {
        EDITOR.tryBlock(clearTable, "표 비우기 실패", userTableEditInfo.chatIndex, viewSheetsContainer);
    })
    $(document).on('click', '#table_rebuild_button', function () {
        EDITOR.tryBlock(rebuildSheets, "표 재구성 실패");
    })
    // 点击编辑테이블按钮
    $(document).on('click', '#table_edit_mode_button', function () {
        // openTableEditorPopup();
    })
    // 点击恢复테이블按钮
    $(document).on('click', '#table_undo', function () {
        EDITOR.tryBlock(undoTable, "표 복원 실패");
    })
    // 点击复制테이블按钮
    $(document).on('click', '#copy_table_button', function () {
        EDITOR.tryBlock(copyTable, "표 복사 실패");
    })
    // 点击导入테이블按钮
    $(document).on('click', '#import_table_button', function () {
        EDITOR.tryBlock(importTable, "표 가져오기 실패", userTableEditInfo.chatIndex, viewSheetsContainer);
    })
    // 点击导出테이블按钮
    $(document).on('click', '#export_table_button', function () {
        EDITOR.tryBlock(exportTable, "표 내보내기 실패");
    })

    return initializedTableView;
}

export async function refreshContextView() {
    if(BASE.contextViewRefreshing) return
    BASE.contextViewRefreshing = true
    await renderSheetsDOM();
    console.log("새로고침테이블视图")
    BASE.contextViewRefreshing = false
}

export async function getChatSheetsView(mesId = -1) {
    // 如果已经初始化过，直接返回缓存的容器，避免重复创建
    if (initializedTableView) {
        // 更新테이블内容，但不重新创建整个容器
        await renderSheetsDOM();
        return initializedTableView;
    }
    return await initTableView(mesId);
}
