// sheetStyleEditor.js
import { BASE, DERIVED, EDITOR, SYSTEM, USER } from '../../core/manager.js';
import { initializeText, parseSheetRender, loadValueSheetBySheetHashSheet } from "../renderer/sheetCustomRenderer.js";

let elements = null;
let templateInstance = null;

// 默认样式配置
const DEFAULT_STYLE = { mode: 'regex', basedOn: 'html', regex: '.*', replace: '' };

/**
 * DOM 元素工具함수
 */
const dom = {
    setValue: (element, value) => element.get(0).value = value,
    getValue: (element) => element.get(0).value,
    setChecked: (element, checked) => element.get(0).checked = checked,
    isChecked: (element) => element.get(0).checked,
    toggleVisibility: (element, visible) => visible ? element.show() : element.hide(),
    triggerEvent: (element, eventName) => {
        const event = new Event(eventName);
        element.get(0).dispatchEvent(event);
    },
    addOption: (select, value, text) => {
        const option = document.createElement('option');
        option.value = value;
        option.text = text || value;
        select.get(0).appendChild(option);
        return option;
    }
};

/**
 * 统一的编辑器새로고침方法
 */
function refreshEditor() {
    // console.log("refreshEditor-elements.rendererDisplay 是否存在:", !!elements.rendererDisplay);
    // console.log("jQuery 对象长度:", elements.rendererDisplay?.length || 0);
    renderHTML();
    updateGuideContent(elements, dom.getValue(elements.matchMethod) === 'regex');
    dom.toggleVisibility(elements.table_renderer_display_container, dom.isChecked(elements.tablePreviewButton));
    dom.toggleVisibility(elements.styleEnabledView, dom.isChecked(elements.tableStyleButton));
}

// function renderHTML() {
//     const currentConfig = collectConfigThenUpdateTemplate();
//     console.log("测试", currentConfig, templateInstance)
//     if (currentConfig.useCustomStyle === true) {
//         templateInstance.tableSheet = loadValueSheetBySheetHashSheet(templateInstance);  //修改后的渲染逻辑为渲染tableSheet
//         elements.rendererDisplay.html(parseSheetRender(templateInstance, currentConfig));
//     } else {
//         elements.rendererDisplay.html(templateInstance.element);
//     }
//     elements.rendererDisplay.css('white-space', 'pre-wrap');
// }

/**
 * 渲染HTML,修复在HTML包含<script>标签时jQuery内部处理异常
 */
function renderHTML() {
    const currentConfig = collectConfigThenUpdateTemplate();
    if (!elements?.rendererDisplay?.length) return;
    templateInstance.tableSheet = loadValueSheetBySheetHashSheet(templateInstance);
    let renderedHTML = currentConfig.useCustomStyle
        ? parseSheetRender(templateInstance, currentConfig)
        : templateInstance.element;
    // 当返回为替换后的string时，移除所有<script>标签；否则返回的将是数组无需处理
    renderedHTML = typeof renderedHTML === 'string' ? renderedHTML.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ''): renderedHTML;

    // 改用原生方法삽입
    elements.rendererDisplay[0].innerHTML = renderedHTML;
    elements.rendererDisplay.css('white-space', 'pre-wrap');
}
/**
 * 获取UI元素绑定对象
 * @param {Object} $dlg jQuery对象
 */
async function getUIElements($dlg) {
    return {
        rendererDisplay: $dlg.find('#tableRendererDisplay'),
        styleEnabledView: $dlg.find('#table_style_enabled_container'),
        benchmark: $dlg.find('#push_to_chat_based_on'),
        regex: $dlg.find('#table_to_chat_regex'),
        replace: $dlg.find('#table_to_chat_replace'),
        tableToChatButton: $dlg.find('#table_to_chat_button'),
        tableStyleButton: $dlg.find('#table_style_button'),
        triggerSendToChatButton: $dlg.find('#table_triggerSendToChat_button'),
        alternateTableButton: $dlg.find('#table_alternateTable_button'),
        insertTableButton: $dlg.find('#table_insertTable_button'),
        skipTopButton: $dlg.find('#table_skipTop_button'),
        tablePreviewButton: $dlg.find('#table_style_preview_button'),
        presetStyle: $dlg.find('#preset_style'),
        matchMethod: $dlg.find('#match_method'),
        addStyleButton: $dlg.find('#table-push-to-chat-style-add'),
        editStyleButton: $dlg.find('#table-push-to-chat-style-edit'),
        importStyleButton: $dlg.find('#table-push-to-chat-style-import'),
        exportStyleButton: $dlg.find('#table-push-to-chat-style-export'),
        deleteStyleButton: $dlg.find('#table-push-to-chat-style-delete'),
        debugStyleButton: $dlg.find('#table-push-to-chat-style-debug'),
        previewStyleButton: $dlg.find('#table-push-to-chat-style-preview'),
        copyTextButton: $dlg.find('#table-push-to-chat-style-export'),
        table_renderer_display_container: $dlg.find('#table_renderer_display_container'),
        match_method_regex_container: $dlg.find('#match_method_regex_container'),
        push_to_chat_style_edit_guide_content: $dlg.find('#push_to_chat_style_edit_guide_content'),
        alternateLevel: $dlg.find('#table_to_alternate'),
    };
}

/**
 * 업데이트指南内容
 */
function updateGuideContent(elements, isRegex) {
    dom.toggleVisibility(elements.match_method_regex_container, isRegex);
    elements.push_to_chat_style_edit_guide_content.html(isRegex
        ? `표준 정규식 문법을 지원하며, <cycleDivide></cycleDivide>로 코드 일부를 감싸면 국소 반복이 가능합니다. 예: 아이템, 퀘스트 접기 등에 사용됩니다.`
        : `스타일 내용이 비어 있을 경우 기본적으로 원본 테이블을 표시합니다. HTML, CSS를 사용해 구조와 스타일을 정의할 수 있으며, <code>\\$\\w\\s+</code> 형식으로 셀을 지정할 수 있습니다.<br>예를 들어 <code>$A0</code>는 1열 1행(헤더), <code>$A1</code>는 1열 2행(본문 첫 행)을 의미합니다.`
    );
}

/**
 * 获取当前选中样式
 */
function getCurrentSelectedStyle() {
    if (!templateInstance.config.customStyles || Object.keys(templateInstance.config.customStyles).length === 0) {
        return DEFAULT_STYLE;
    }

    const selectedKey = templateInstance.config.selectedCustomStyleKey;
    return templateInstance.config.customStyles[selectedKey] || templateInstance.config.customStyles[Object.keys(templateInstance.config.customStyles)[0]] || DEFAULT_STYLE;
}

/**
 * 获取当前UI테이블单数据
 */
function getFormData() {
    return {
        mode: dom.getValue(elements.matchMethod),
        basedOn: dom.getValue(elements.benchmark),
        regex: dom.getValue(elements.regex),
        replace: dom.getValue(elements.replace)
    };
}

/**
 * 设置테이블单数据
 */
function setFormData(style = {}) {
    const data = { ...DEFAULT_STYLE, ...style };
    dom.setValue(elements.matchMethod, data.mode);
    dom.setValue(elements.benchmark, data.basedOn);
    dom.setValue(elements.regex, data.regex);
    dom.setValue(elements.replace, data.replace);
}

/**
 * 初始化테이블样式预览
 */
function setupSheetPreview() {
    if (!templateInstance) {
        console.warn("setupSheetPreview: 유효한 table 객체를 가져오지 못했습니다.");
        return;
    }

    // 初始化样式预览테이블
    templateInstance.element = null
    templateInstance.element = `<div class="justifyLeft scrollable">${templateInstance.renderSheet((cell) => {
        cell.element.style.cursor = 'default';
    }).outerHTML}</div>`;
    // console.log("setupSheetPreview-elements.rendererDisplay 是否存在:", !!elements.rendererDisplay);
    // console.log("jQuery 对象长度:", elements.rendererDisplay?.length || 0);
    renderHTML();
    dom.toggleVisibility(elements.table_renderer_display_container, false);
}

/**
 * 从UI收集配置
 */
function collectConfigThenUpdateTemplate() {
    const selectedKey = dom.getValue(elements.presetStyle);
    const styleName = elements.presetStyle.find('option:selected').text();
    const customStyles = { ...(templateInstance.config.customStyles || {}) };
    const currentStyle = getFormData();
    if (selectedKey !== 'default' || Object.keys(customStyles).length === 0) {
        customStyles[styleName] = currentStyle;
    }

    const config = {
        toChat: dom.isChecked(elements.tableToChatButton),
        useCustomStyle: dom.isChecked(elements.tableStyleButton),
        triggerSendToChat: dom.isChecked(elements.triggerSendToChatButton),
        alternateTable: dom.isChecked(elements.alternateTableButton),
        insertTable: dom.isChecked(elements.insertTableButton),
        skipTop: dom.isChecked(elements.skipTopButton),
        alternateLevel: dom.getValue(elements.alternateLevel),
        selectedCustomStyleKey: styleName,
        customStyles: customStyles
    };
    templateInstance.config = config;
    return config;
}

/**
 * 渲染预览
 */
function renderPreview() {
    try {
        const regex = dom.getValue(elements.regex);
        const replace = dom.getValue(elements.replace);

        if (regex && replace) {
            const htmlContent = elements.rendererDisplay.html();
            const regExp = new RegExp(regex, 'g');
            elements.rendererDisplay.html(htmlContent.replace(regExp, replace));
        }
    } catch (e) {
        console.error("Preview rendering error:", e);
    }
}

/**
 * 初始化UI值
 */
function initUIValues() {
    // 初始化复选框
    dom.setChecked(elements.tableToChatButton, templateInstance.config.toChat !== false);
    dom.setChecked(elements.tableStyleButton, templateInstance.config.useCustomStyle !== false);
    dom.setChecked(elements.triggerSendToChatButton, templateInstance.config.triggerSendToChat !== false);
    dom.setChecked(elements.alternateTableButton, templateInstance.config.alternateTable == true);
    dom.setChecked(elements.insertTableButton, templateInstance.config.insertTable == true);
    dom.setChecked(elements.skipTopButton, templateInstance.config.skipTop == true);
    dom.setChecked(elements.tablePreviewButton, false);
    dom.setValue(elements.alternateLevel, templateInstance.config.alternateLevel || 0);
    initPresetStyleDropdown();
    setFormData(getCurrentSelectedStyle());
}

/**
 * 初始化预设样式下拉框
 */
function initPresetStyleDropdown() {
    const presetDropdown = elements.presetStyle;
    presetDropdown.empty();

    if (templateInstance.config.customStyles && Object.keys(templateInstance.config.customStyles).length > 0) {
        // 添加所有自定义样式
        Object.keys(templateInstance.config.customStyles).forEach(styleName => {
            dom.addOption(presetDropdown, styleName);
        });

        // 设置选中项
        if (templateInstance.config.selectedCustomStyleKey && templateInstance.config.customStyles[templateInstance.config.selectedCustomStyleKey]) {
            dom.setValue(presetDropdown, templateInstance.config.selectedCustomStyleKey);
        } else {
            const firstStyleKey = presetDropdown.find('option:first').get(0).value;
            dom.setValue(presetDropdown, firstStyleKey);
            templateInstance.config.selectedCustomStyleKey = firstStyleKey;
        }
    } else {
        dom.addOption(presetDropdown, 'default', '기본');
    }
}

/**
 * 绑定所有事件处理程序
 */
function bindEvents() {
    // 绑定基本输入元素事件
    ['input', 'input', 'change', 'change', 'change', 'change'].forEach((eventType, i) => {
        [elements.regex, elements.replace, elements.tablePreviewButton,
        elements.matchMethod, elements.benchmark, elements.tableStyleButton][i]
            .get(0).addEventListener(eventType, refreshEditor);
    });

    // 预设样式切换事件
    elements.presetStyle.get(0).addEventListener('change', function (event) {
        const selectedKey = event.target.value;
        const selectedStyle = templateInstance.config.customStyles[selectedKey];
        if (selectedStyle) {
            setFormData(selectedStyle);
            refreshEditor();
        }
    });

    bindStyleManagementEvents();
    bindPreviewAndCopyEvents();
}

/**
 * 绑定样式管理按钮事件
 */
function bindStyleManagementEvents() {
    // 添加样式
    elements.addStyleButton.get(0).addEventListener('click', async function () {
        const styleName = await EDITOR.callGenericPopup("새 스타일 이름을 입력하세요: ", EDITOR.POPUP_TYPE.INPUT);
        if (!styleName) return;

        templateInstance.config.customStyles = templateInstance.config.customStyles || {};
        templateInstance.config.customStyles[styleName] = getFormData();
        dom.addOption(elements.presetStyle, styleName);
        dom.setValue(elements.presetStyle, styleName);
        dom.triggerEvent(elements.presetStyle, 'change');
    });

    // 编辑样式名称
    elements.editStyleButton.get(0).addEventListener('click', async function () {
        const selectedKey = dom.getValue(elements.presetStyle);
        if (selectedKey === 'default' || !templateInstance.config.customStyles[selectedKey]) return;

        const newName = await EDITOR.callGenericPopup("스타일 이름을 수정하세요:", EDITOR.POPUP_TYPE.INPUT, selectedKey);
        if (!newName || newName === selectedKey) return;

        // 重命名样式
        templateInstance.config.customStyles[newName] = templateInstance.config.customStyles[selectedKey];
        delete templateInstance.config.customStyles[selectedKey];

        // 업데이트下拉菜单
        const option = elements.presetStyle.find(`option[value="${selectedKey}"]`).get(0);
        option.text = newName;
        option.value = newName;
        dom.setValue(elements.presetStyle, newName);
    });

    // 删除样式
    elements.deleteStyleButton.get(0).addEventListener('click', async function () {
        const selectedKey = dom.getValue(elements.presetStyle);
        if (selectedKey === 'default') {
            return EDITOR.error('기본 스타일은 삭제할 수 없습니다');
        }

        const confirmation = await EDITOR.callGenericPopup("이 스타일을 삭제하시겠습니까?", EDITOR.POPUP_TYPE.CONFIRM);
        if (!confirmation) return;

        delete templateInstance.config.customStyles[selectedKey];
        elements.presetStyle.find(`option[value="${selectedKey}"]`).remove();
        dom.setValue(elements.presetStyle, elements.presetStyle.find('option:first').get(0).value);
        dom.triggerEvent(elements.presetStyle, 'change');
    });

    // 스타일 가져오기 
    elements.importStyleButton.get(0).addEventListener('click', async function () {
        const importData = await EDITOR.callGenericPopup("스타일 구성 JSON 붙여넣기:", EDITOR.POPUP_TYPE.INPUT, '', { rows: 10 });
        if (!importData) return;

        try {
            const styleData = JSON.parse(importData);
            const styleName = styleData.name || "스타일 가져오기 ";

            // 移除不需要的属性
            delete styleData.name;
            delete styleData.uid;

            templateInstance.config.customStyles = templateInstance.config.customStyles || {};
            templateInstance.config.customStyles[styleName] = styleData;

            dom.addOption(elements.presetStyle, styleName);
            dom.setValue(elements.presetStyle, styleName);
            dom.triggerEvent(elements.presetStyle, 'change');

            EDITOR.success('스타일 가져오기 성공');
        } catch (e) {
            EDITOR.error('스타일 가져오기 실패, JSON 형식 오류', e.message, e);
        }
    });

    // 导出样式
    elements.exportStyleButton.get(0).addEventListener('click', function () {
        const selectedKey = dom.getValue(elements.presetStyle);
        if (selectedKey === 'default' || !templateInstance.config.customStyles[selectedKey]) return;

        const exportData = { ...templateInstance.config.customStyles[selectedKey], name: selectedKey };
        navigator.clipboard.writeText(JSON.stringify(exportData, null, 2))
            .then(() => EDITOR.success('스타일이 클립보드에 복사되었습니다'));
    });
}

/**
 * 绑定预览和复制按钮事件
 */
function bindPreviewAndCopyEvents() {
    // 预览按钮
    elements.previewStyleButton.get(0).addEventListener('click', async () => {
        const currentConfig = collectConfigThenUpdateTemplate();
        const selectedStyle = currentConfig.customStyles[currentConfig.selectedCustomStyleKey];
        const initialText = initializeText(templateInstance, selectedStyle);
        const benchmarkValue = dom.getValue(elements.benchmark);

        // 创建选择器选项
        const benchmarkOptions = Array.from(elements.benchmark.get(0).options)
            .map(option => `<option value="${option.value}" ${option.value === benchmarkValue ? 'selected' : ''}>${option.text}</option>`)
            .join('');

        const previewHtml = `
            <div>
                <div style="margin-bottom: 10px; display: flex; align-items: center;">
                    <span style="margin-right: 10px;">기반:</span>
                    <select id="preview_benchmark_selector" style="min-width: 100px">${benchmarkOptions}</select>
                </div>
                <textarea id="table_to_chat_text_preview" rows="10" style="width: 100%">${initialText}</textarea>
            </div>`;

        const popup = new EDITOR.Popup(previewHtml, EDITOR.POPUP_TYPE.TEXT, '', { wide: true });
        const $dlg = $(popup.dlg);

        popup.show().then(() => {
            dom.setValue(elements.benchmark, selectedStyle.basedOn);
            refreshEditor();
        });

        setTimeout(() => {
            $dlg.find('#preview_benchmark_selector').on('change', function () {
                selectedStyle.basedOn = this.value;
                $dlg.find('#table_to_chat_text_preview').val(initializeText(templateInstance, selectedStyle));
            });
        }, 0);
    });

    // 复制按钮
    elements.copyTextButton.get(0).addEventListener('click', () =>
        navigator.clipboard.writeText(elements.rendererDisplay.html())
            .then(() => EDITOR.success('HTML 내용이 클립보드에 복사되었습니다')));
}

/**
 * 初始化编辑器组件和值
 */
async function initializeEditor() {
    initUIValues();
    setupSheetPreview();
    renderPreview();

    setTimeout(() => {
        updateGuideContent(elements, dom.getValue(elements.matchMethod) === 'regex');
        refreshEditor();
    }, 0);
}

/**
 * 打开테이블样式渲染器弹窗
 * @param {Object} originInstance 原始테이블对象
 * @returns {Promise<Object>} 处理结果
 */
export async function openSheetStyleRendererPopup(originInstance) {
    // 初始化弹窗
    const manager = await SYSTEM.getTemplate('customSheetStyle');
    const tableRendererPopup = new EDITOR.Popup(manager, EDITOR.POPUP_TYPE.CONFIRM, '', { large: true, wide: true, allowVerticalScrolling: true, okButton: "편집 저장", cancelButton: "취소" });
    const $dlg = $(tableRendererPopup.dlg);
    templateInstance = originInstance;

    // 初始化
    elements = await getUIElements($dlg);
    await initializeEditor();
    bindEvents();

    // 显示弹窗并处理结果
    await tableRendererPopup.show();

    if (tableRendererPopup.result) {
        const finalConfig = collectConfigThenUpdateTemplate();
        const alternateLevel = Number(finalConfig.alternateLevel);
        const styleBasedOn = ["html", "csv", "json", "array"];
        const numberBoollen = isNaN(alternateLevel) || alternateLevel < 0 || Number.isInteger(alternateLevel) === false;  //是否满足非负整数
        const styleBoollen = styleBasedOn.includes(finalConfig.customStyles[finalConfig.selectedCustomStyleKey].basedOn);      //方式必须为html、csv、json、array
        if (numberBoollen || (alternateLevel > 0 && !styleBoollen)) {     //输入的삽입层级必须为非负整数，且하지 못하다为MarkDown格式否则改为0
            finalConfig.alternateLevel = 0;
            EDITOR.warning('교대 숫자는 음이 아닌 정수여야 합니다，마크다운 형식이 아니면 강제로 0으로 변경합니다');
        }
        Object.assign(originInstance.config, finalConfig);
        console.log('테이블 스타일 업데이트되었습니다.', originInstance.config.alternateLevel);
        originInstance.save();
        BASE.updateSystemMessageTableStatus()
        EDITOR.success('테이블 스타일 업데이트');
    }
}
