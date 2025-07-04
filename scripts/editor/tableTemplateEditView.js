// tableTemplateEditView.js
import { BASE, DERIVED, EDITOR, SYSTEM, USER } from '../../core/manager.js';
import { PopupMenu } from '../../components/popupMenu.js';
import { Form } from '../../components/formManager.js';
import { openSheetStyleRendererPopup } from "./sheetStyleEditor.js";
import { compareDataDiff } from "../../utils/utility.js";

let drag = null;
let currentPopupMenu = null;
let dropdownElement = null;
const renderedTables = new Map();
let scope = 'chat'

const formConfigs = {
    sheet_origin: {
        formTitle: "표 편집",
        formDescription: "단일 표의 전체 설정.",
        fields: [

        ]
    },
    column_header: {
        formTitle: "열 편집",
        formDescription: "열의 제목과 설명 정보 설정.",
        fields: [
            { label: '열 제목', type: 'text', dataKey: 'value' },
            { label: '값 중복 불가', type: 'checkbox', dataKey: 'valueIsOnly' },
            {
                label: '데이터 타입', type: 'select', dataKey: 'columnDataType',
                options: [
                    { value: 'text', text: '텍스트' },
                    // { value: 'number', text: '숫자' },
                    // { value: 'option', text: '옵션' },
                ]
            },
            { label: '열 설명', description: '', type: 'textarea', rows: 4, dataKey: 'columnNote' },
        ],
    },
    row_header: {
        formTitle: "행 편집",
        formDescription: "행의 제목과 설명 정보 설정.",
        fields: [
            { label: '행 제목', type: 'text', dataKey: 'value' },
            { label: '행 설명', description: '(AI에게 이 행의 용도 설명)', type: 'textarea', rows: 4, dataKey: 'rowNote' },
        ],
    },
    cell: {
        formTitle: "셀 편집",
        formDescription: "셀의 구체적인 내용 편집.",
        fields: [
            { label: '셀 내용', type: 'textarea', dataKey: 'value' },
            { label: '셀 설명', description: '(AI에게 이 셀 내용의 용도 설명)', type: 'textarea', rows: 4, dataKey: 'cellPrompt' },
        ],
    },
    sheetConfig: {
        formTitle: "표 속성 편집",
        formDescription: "표의 도메인, 유형 및 이름을 설정합니다.",
        fields: [
            /* {
                label: '기본 저장 위치', type: 'select', dataKey: 'domain',
                options: [
                    // { value: 'global', text: `<i class="fa-solid fa-earth-asia"></i> Global（이 템플릿은 사용자 데이터에 저장됨）` },
                    // { value: 'role', text: `<i class="fa-solid fa-user-tag"></i> Role（이 템플릿은 현재 선택된 역할에 저장됨）` },
                    { value: 'chat', text: `<i class="fa-solid fa-comment"></i> Chat（이 템플릿은 현재 대화에 저장됨）` },
                ],
            }, */
            {
                label: '유형', type: 'select', dataKey: 'type',
                options: [
                    // { value: 'free', text: `<i class="fa-solid fa-table"></i> Free（AI가 이 표를 자유롭게 수정 가능）` },
                    { value: 'dynamic', text: `<i class="fa-solid fa-arrow-down-wide-short"></i> Dynamic（AI가 열 삽입을 제외한 모든 작업 가능）` },
                    // { value: 'fixed', text: `<i class="fa-solid fa-thumbtack"></i> Fixed（AI가 행과 열을 삭제하거나 삽입할 수 없음）` },
                    // { value: 'static', text: `<i class="fa-solid fa-link"></i> Static（AI에게 읽기 전용）` }
                ],
            },
            { label: '표 이름', type: 'text', dataKey: 'name' },
            { label: '표 설명(프롬프트)', type: 'textarea', rows: 6, dataKey: 'note', description: '(이 표의 전체 프롬프트로서, AI에게 이 표의 용도 설명)' },
            { label: '필수 입력', type: 'checkbox', dataKey: 'required' },
            { label: '전송 트리거', type: 'checkbox', dataKey: 'triggerSend', },
            { label: '트리거 깊이', type: 'number', dataKey: 'triggerSendDeep' },
            { label: '초기화 프롬프트', type: 'textarea', rows: 4, dataKey: 'initNode', description: '(이 표가 필수이고 비어있을 때, AI에게 표 작성을 요청하는 프롬프트)' },
            { label: '삽입 프롬프트', type: 'textarea', rows: 4, dataKey: 'insertNode', description: '' },
            { label: '삭제 프롬프트', type: 'textarea', rows: 4, dataKey: 'deleteNode', description: '' },
            { label: '업데이트 프롬프트', type: 'textarea', rows: 4, dataKey: 'updateNode', description: '' },
        ],
    },
};


async function updateDropdownElement() {
    const templates = getSheets();
    // console.log("드롭다운 템플릿", templates)
    if (dropdownElement === null) {
        dropdownElement = document.createElement('select');
        dropdownElement.id = 'table_template';
        dropdownElement.classList.add('select2_multi_sameline', 'select2_choice_clickable', 'select2_choice_clickable_buttonstyle');
        dropdownElement.multiple = true;
    }
    dropdownElement.innerHTML = '';
    for (const t of templates) {
        const optionElement = document.createElement('option');
        optionElement.value = t.uid;
        optionElement.textContent = t.name;
        dropdownElement.appendChild(optionElement);
    }

    return dropdownElement;
}

function getAllDropdownOptions() {
    return $(dropdownElement).find('option').toArray().map(option => option.value);
}

function updateSelect2Dropdown() {
    let selectedSheets = getSelectedSheetUids()
    if (selectedSheets === undefined) {
        selectedSheets = [];
    }
    $(dropdownElement).val(selectedSheets).trigger("change", [true])
}

function initChatScopeSelectedSheets() {
    const newSelectedSheets = BASE.sheetsData.context.map(sheet => sheet.enable ? sheet.uid : null).filter(Boolean)
    USER.getContext().chatMetadata.selected_sheets = newSelectedSheets
    return newSelectedSheets
}

function updateSelectedSheetUids() {
    if (scope === 'chat') {
        USER.saveChat()
        console.log("여기서 트리거됨")
        BASE.refreshContextView()
    }
    else USER.saveSettings();
    updateDragTables();
}

function initializeSelect2Dropdown(dropdownElement) {
    $(dropdownElement).select2({
        closeOnSelect: false,
        templateResult: function (data) {
            if (!data.id) {
                return data.text;
            }
            var $wrapper = $('<span class="select2-option" style="width: 100%"></span>');
            var $checkbox = $('<input type="checkbox" class="select2-option-checkbox"/>');
            $checkbox.prop('checked', data.selected);
            $wrapper.append(data.text);
            return $wrapper;
        },
        templateSelection: function (data) {
            return data.text;
        },
        escapeMarkup: function (markup) {
            return markup;
        }
    });

    updateSelect2Dropdown()

    $(dropdownElement).on('change', function (e, silent) {
        //if(silent || scope === 'chat') return
        console.log("선택됨",silent,$(this).val())
        if (silent) return
        setSelectedSheetUids($(this).val())
        updateSelectedSheetUids()
    });

    // 부모 체크박스와 드롭다운 박스의 연결 생성
    const firstOptionText = $(dropdownElement).find('option:first-child').text();
    const tableMultipleSelectionDropdown = $('<span class="select2-option" style="width: 100%"></span>');
    const checkboxForParent = $('<input type="checkbox" class="select2-option-checkbox"/>');
    tableMultipleSelectionDropdown.append(checkboxForParent);
    tableMultipleSelectionDropdown.append(firstOptionText);
    $('#parentFileBox')?.append(tableMultipleSelectionDropdown);

    const select2MultipleSelection = $(dropdownElement).next('.select2-container--default');
    if (select2MultipleSelection.length) {
        select2MultipleSelection.css('width', '100%');
    }
}

function updateSheetStatusBySelect() {
    const selectedSheetsUid = getSelectedSheetUids()
    const templates = getSheets()
    templates.forEach(temp => {
        if (selectedSheetsUid.includes(temp.uid)) temp.enable = true
        else temp.enable = false
        temp.save && temp.save(undefined, true)
    })
}

export function updateSelectBySheetStatus() {
    const templates = getSheets()
    const selectedSheetsUid = templates.filter(temp => temp.enable).map(temp => temp.uid)
    setSelectedSheetUids(selectedSheetsUid)
}

let table_editor_container = null


function bindSheetSetting(sheet, index) {
    const titleBar = document.createElement('div');
    titleBar.className = 'table-title-bar';
    titleBar.style.display = 'flex';
    titleBar.style.alignItems = 'center';
    titleBar.style.minWidth = '500px';
    titleBar.style.gap = '5px';
    titleBar.style.color = 'var(--SmartThemeEmColor)';
    titleBar.style.fontSize = '0.8rem';
    titleBar.style.fontWeight = 'normal';

    // 표 기본 설정 버튼
    const settingButton = $(`<i class="menu_button menu_button_icon fa-solid fa-wrench" style="cursor: pointer; height: 28px; width: 28px;" title="표 속성 편집"></i>`);
    settingButton.on('click', async () => {
        const initialData = {
            domain: sheet.domain,
            type: sheet.type,
            name: sheet.name,
            note: sheet.data.note,
            initNode: sheet.data.initNode,
            insertNode: sheet.data.insertNode,
            deleteNode: sheet.data.deleteNode,
            updateNode: sheet.data.updateNode,
            required: sheet.required,
            triggerSend: sheet.triggerSend,
            triggerSendDeep: sheet.triggerSendDeep
        };
        const formInstance = new Form(formConfigs.sheetConfig, initialData);
        const popup = new EDITOR.Popup(formInstance.renderForm(), EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "저장", allowVerticalScrolling: true, cancelButton: "취소" });

        await popup.show();
        if (popup.result) {
            const diffData = compareDataDiff(formInstance.result(), initialData)
            console.log(diffData)
            let needRerender = false
            // 데이터 차이 비교 결과를 표에 업데이트
            Object.keys(diffData).forEach(key => {
                console.log(key)
                if (['domain', 'type', 'name', 'required', 'triggerSend'].includes(key) && diffData[key] != null) {
                    console.log("비교 성공, 업데이트 예정: " + key)
                    sheet[key] = diffData[key];
                    if (key === 'name') needRerender = true
                } else if (['note', 'initNode', 'insertNode', 'deleteNode', 'updateNode'].includes(key) && diffData[key] != null) {
                    sheet.data[key] = diffData[key];
                } else if (['triggerSendDeep'].includes(key) && diffData[key] != null) {
                    console.log("비교 성공, 업데이트 예정: " + key)
                    sheet[key] = Math.max(0, Math.floor(diffData[key]));
                }
            })
            sheet.save()
            if (needRerender) refreshTempView()
        }
    });

    // 표 사용자 정의 스타일 버튼
    const styleButton = $(`<i class="menu_button menu_button_icon fa-solid fa-wand-magic-sparkles" style="cursor: pointer; height: 28px; width: 28px;" title="표 표시 스타일 편집"></i>`);
    styleButton.on('click', async () => {
        await openSheetStyleRendererPopup(sheet);
    })
    const nameSpan = $(`<span style="margin-left: 0px;">#${index} ${sheet.name ? sheet.name : 'Unnamed Table'}</span>`);

    // 신규: 컨텍스트로 전송 체크박스
    const sendToContextCheckbox = $(`
        <label class="checkbox_label" style="margin-left: 10px; font-weight: normal; color: var(--text_primary);">
            <input type="checkbox" class="send_to_context_switch" ${sheet.sendToContext !== false ? 'checked' : ''} />
            <span data-i18n="Send to context">컨텍스트로 전송</span>
        </label>
    `);

    sendToContextCheckbox.find('.send_to_context_switch').on('change', function() {
        sheet.sendToContext = $(this).prop('checked');
        sheet.save();
        console.log(`표 "${sheet.name}"의 sendToContext 상태가 업데이트됨: ${sheet.sendToContext}`);
    });

    titleBar.appendChild(settingButton[0]);
    // titleBar.appendChild(originButton[0]);
    titleBar.appendChild(styleButton[0]);
    titleBar.appendChild(nameSpan[0]);
    titleBar.appendChild(sendToContextCheckbox[0]);

    return titleBar;
}

async function templateCellDataEdit(cell) {
    const initialData = { ...cell.data };
    const formInstance = new Form(formConfigs[cell.type], initialData);

    formInstance.on('editRenderStyleEvent', (formData) => {
        alert('표 스타일 편집 기능 구현 예정' + JSON.stringify(formData));
    });


    const popup = new EDITOR.Popup(formInstance.renderForm(), EDITOR.POPUP_TYPE.CONFIRM, { large: true, allowVerticalScrolling: true }, { okButton: "변경사항 저장", cancelButton: "취소" });

    await popup.show();
    if (popup.result) {
        const diffData = compareDataDiff(formInstance.result(), initialData)
        console.log(diffData)
        Object.keys(diffData).forEach(key => {
            cell.data[key] = diffData[key];
        })
        const pos = cell.position
        cell.parent.save()
        cell.renderCell()
        // cell.parent.updateRender()
        refreshTempView(true);
        if (scope === 'chat') BASE.refreshContextView()
    }
}

function handleAction(cell, action) {
    console.log("작업 실행 시작")
    cell.newAction(action)
    console.log("작업 실행 후 새로고침")
    refreshTempView();
    // chat 영역인 경우 표 새로고침
    if (scope === 'chat') BASE.refreshContextView()
}


function bindCellClickEvent(cell) {
    cell.on('click', async (event) => {
        event.stopPropagation();
        if (cell.parent.currentPopupMenu) {
            cell.parent.currentPopupMenu.destroy();
            cell.parent.currentPopupMenu = null;
        }
        cell.parent.currentPopupMenu = new PopupMenu();

        const [rowIndex, colIndex] = cell.position;
        const sheetType = cell.parent.type;

        if (rowIndex === 0 && colIndex === 0) {
            cell.parent.currentPopupMenu.add('<i class="fa fa-arrow-right"></i> 오른쪽에 열 삽입', (e) => { handleAction(cell, cell.CellAction.insertRightColumn) });
            if (sheetType === cell.parent.SheetType.free || sheetType === cell.parent.SheetType.static) {
                cell.parent.currentPopupMenu.add('<i class="fa fa-arrow-down"></i> 아래에 행 삽입', (e) => { handleAction(cell, cell.CellAction.insertDownRow) });
            }
        } else if (rowIndex === 0) {
            cell.parent.currentPopupMenu.add('<i class="fa fa-i-cursor"></i> 선택 열 편집', async (e) => { await templateCellDataEdit(cell) });
            cell.parent.currentPopupMenu.add('<i class="fa fa-arrow-left"></i> 왼쪽에 열 삽입', (e) => { handleAction(cell, cell.CellAction.insertLeftColumn) });
            cell.parent.currentPopupMenu.add('<i class="fa fa-arrow-right"></i> 오른쪽에 열 삽입', (e) => { handleAction(cell, cell.CellAction.insertRightColumn) });
            cell.parent.currentPopupMenu.add('<i class="fa fa-trash-alt"></i> 열 삭제', (e) => { handleAction(cell, cell.CellAction.deleteSelfColumn) });
        } else if (colIndex === 0) {
            // if (sheetType === cell.parent.SheetType.dynamic) {
            //     cell.element.delete();
            //     return;
            // }

            cell.parent.currentPopupMenu.add('<i class="fa fa-i-cursor"></i> 선택 행 편집', async (e) => { await templateCellDataEdit(cell) });
            if (sheetType === cell.parent.SheetType.free || sheetType === cell.parent.SheetType.static) {
                cell.parent.currentPopupMenu.add('<i class="fa fa-arrow-up"></i> 위에 행 삽입', (e) => { handleAction(cell, cell.CellAction.insertUpRow) });
                cell.parent.currentPopupMenu.add('<i class="fa fa-arrow-down"></i> 아래에 행 삽입', (e) => { handleAction(cell, cell.CellAction.insertDownRow) });
                cell.parent.currentPopupMenu.add('<i class="fa fa-trash-alt"></i> 행 삭제', (e) => { handleAction(cell, cell.CellAction.deleteSelfRow) });
            }
        } else {
            if (sheetType === cell.parent.SheetType.static) {
                cell.parent.currentPopupMenu.add('<i class="fa fa-i-cursor"></i> 선택 셀 편집', async (e) => { await templateCellDataEdit(cell) });
            } else {
                return;
            }
        }

        const element = event.target
        // 현재 셀의 스타일을 백업하여 메뉴가 닫힐 때 복원
        const style = element.style.cssText;
        const rect = element.getBoundingClientRect();
        const dragSpaceRect = drag.dragSpace.getBoundingClientRect();
        let popupX = rect.left - dragSpaceRect.left;
        let popupY = rect.top - dragSpaceRect.top;
        popupX /= drag.scale;
        popupY /= drag.scale;
        popupY += rect.height / drag.scale + 3;

        element.style.backgroundColor = 'var(--SmartThemeUserMesBlurTintColor)';
        element.style.color = 'var(--SmartThemeQuoteColor)';
        element.style.outline = '1px solid var(--SmartThemeQuoteColor)';
        element.style.zIndex = '999';

        drag.add('menu', cell.parent.currentPopupMenu.renderMenu());
        cell.parent.currentPopupMenu.show(popupX, popupY).then(() => {
            element.style.cssText = style;
        });
    });
}

function getSelectedSheetUids() {
    return scope === 'chat' ? USER.getContext().chatMetadata.selected_sheets ?? initChatScopeSelectedSheets() : USER.getSettings().table_selected_sheets ?? []
}

function setSelectedSheetUids(selectedSheets) {
    if (scope === 'chat') {
        USER.getContext().chatMetadata.selected_sheets = selectedSheets;
    } else {
        USER.getSettings().table_selected_sheets = selectedSheets;
    }
    updateSheetStatusBySelect()
}

function getSheets() {
    return scope === 'chat' ? BASE.getChatSheets() : BASE.templates
}


async function updateDragTables() {
    if (!drag) return;

    const selectedSheetUids = getSelectedSheetUids()
    const container = $(drag.render).find('#tableContainer');
    table_editor_container.querySelector('#contentContainer').style.outlineColor = scope === 'chat' ? '#cf6e64' : '#41b681';

    if (currentPopupMenu) {
        currentPopupMenu.destroy();
        currentPopupMenu = null;
    }

    container.empty();
    console.log("dragSpace 값 확인", drag.dragSpace)

    selectedSheetUids.forEach((uid, index) => {

        let sheetDataExists;
        if (scope === 'chat') {
            // uid가 BASE.sheetsData.context에 존재하는지 확인
            sheetDataExists = BASE.sheetsData.context?.some(sheetData => sheetData.uid === uid);
        } else {
            // uid가 BASE.templates에 존재하는지 확인
            sheetDataExists = BASE.templates?.some(templateData => templateData.uid === uid);
        }
        // 데이터가 존재하지 않으면 경고를 기록하고 이 uid를 건너뜀
        if (!sheetDataExists) {
            console.warn(`updateDragTables에서 UID가 ${uid}인 표 데이터를 찾을 수 없습니다 (scope: ${scope}). 이 표를 건너뜁니다.`);
            return;
        }

        let sheet = scope === 'chat'
            ? BASE.getChatSheet(uid)
            : new BASE.SheetTemplate(uid);
        sheet.currentPopupMenu = currentPopupMenu;

        // if (!sheet || !sheet.hashSheet) {
        //     console.warn(`템플릿을 불러올 수 없거나 템플릿 데이터가 비어있습니다, UID: ${uid}`);
        //     return
        // }

        const tableElement = sheet.renderSheet(bindCellClickEvent, sheet.hashSheet.slice(0, 1));
        tableElement.style.marginLeft = '5px'
        renderedTables.set(uid, tableElement);
        container.append(tableElement);

        // 표를 추가한 후 hr 요소 추가
        const hr = document.createElement('hr');
        tableElement.appendChild(hr);

        const captionElement = document.createElement('caption');
        captionElement.appendChild(bindSheetSetting(sheet, index));
        if (tableElement.querySelector('caption')) {
            tableElement.querySelector('caption').replaceWith(captionElement);
        } else {
            tableElement.insertBefore(captionElement, tableElement.firstChild);
        }
    })

}

export function updateTableContainerPosition() {
    const windowHeight = window.innerHeight;
    const contentContainer = table_editor_container.querySelector('#contentContainer');
    // console.log("contentContainer", contentContainer)
    const sendFormHeight = document.querySelector('#send_form')?.getBoundingClientRect().height || 0;
    const rect = contentContainer.getBoundingClientRect();
    // console.log("contentContainer 위치 변화", rect, windowHeight, sendFormHeight)
    contentContainer.style.position = 'flex';
    contentContainer.style.bottom = '0';
    contentContainer.style.left = '0';
    contentContainer.style.width = '100%';
    contentContainer.style.height = `calc(${windowHeight}px - ${rect.top}px - ${sendFormHeight}px)`;
}

export async function refreshTempView(ignoreGlobal = false) {
    if (ignoreGlobal && scope === 'global') return        
    console.log("표 템플릿 뷰 새로고침")
    await updateDropdownElement()
    initializeSelect2Dropdown(dropdownElement);
    await updateDragTables();
}

async function initTableEdit(mesId) {
    table_editor_container = $(await SYSTEM.getTemplate('sheetTemplateEditor')).get(0);
    const tableEditTips = table_editor_container.querySelector('#tableEditTips');
    const tableContainer = table_editor_container.querySelector('#tableContainer');
    const contentContainer = table_editor_container.querySelector('#contentContainer');
    const scopeSelect = table_editor_container.querySelector('#structure_setting_scope');

    dropdownElement = await updateDropdownElement()
    $(tableEditTips).after(dropdownElement)
    initializeSelect2Dropdown(dropdownElement);

    $(contentContainer).empty()
    drag = new EDITOR.Drag();
    const draggable = drag.render
    contentContainer.append(draggable);
    drag.add('tableContainer', tableContainer);

    // 이벤트 리스너 추가
    contentContainer.addEventListener('mouseenter', updateTableContainerPosition);
    contentContainer.addEventListener('focus', updateTableContainerPosition);

    $(scopeSelect).val(scope).on('change', async function () {
        scope = $(this).val();
        console.log("전환됨", scope)
        await refreshTempView()
    })

    $(document).on('click', '#add_table_template_button', async function () {
        console.log("트리거됨")
        let newTemplateUid = null
        let newTemplate = null
        if (scope === 'chat') {
            newTemplate = BASE.createChatSheet(2, 1)
            newTemplateUid = newTemplate.uid
            newTemplate.save()
        } else {
            newTemplate = new BASE.SheetTemplate().createNewTemplate();
            newTemplateUid = newTemplate.uid
        }

        let currentSelectedValues = getSelectedSheetUids()
        setSelectedSheetUids([...currentSelectedValues, newTemplateUid])
        if (scope === 'chat') USER.saveChat()
        else USER.saveSettings();
        await updateDropdownElement();
        //updateDragTables();
        console.log("테스트", [...currentSelectedValues, newTemplateUid])
        $(dropdownElement).val([...currentSelectedValues, newTemplateUid]).trigger("change", [true]);
        updateSelectedSheetUids()
    });
    $(document).on('click', '#import_table_template_button', function () {

    })
    $(document).on('click', '#export_table_template_button', function () {

    })
    // $(document).on('click', '#sort_table_template_button', function () {
    //
    // })

    // $(document).on('click', '#table_template_history_button', function () {
    //
    // })
    // $(document).on('click', '#destroy_table_template_button', async function () {
    //     const r = scope ==='chat'? BASE.destroyAllContextSheets() : BASE.destroyAllTemplates()
    //     if (r) {
    //         await updateDropdownElement();
    //         $(dropdownElement).val([]).trigger('change');
    //         updateDragTables();
    //     }
    // });

    updateDragTables();

    return table_editor_container;
}

export async function getEditView(mesId = -1) {
    // 이미 초기화된 경우 캐시된 컨테이너를 반환하여 중복 생성 방지
    if (table_editor_container) {
        // 드롭다운 메뉴와 표를 업데이트하되, 전체 컨테이너는 다시 생성하지 않음
        await refreshTempView(false);
        return table_editor_container;
    }
    return await initTableEdit(mesId);
}