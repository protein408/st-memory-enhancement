import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../core/manager.js';

/**
 * @description 辅助함수，递归创建 Proxy
 * @param {Object} obj - 要代理的对象
 * @returns {Object} - 创建的 Proxy 对象
 */
export const createProxy = (obj) => {
    return new Proxy(obj, {
        get(target, prop) {
            return target[prop];
        },
        set(target, prop, newValue) {
            target[prop] = newValue; // 直接修改原始的 props 对象
            return true;
        },
    });
}

export const createProxyWithUserSetting = (target, allowEmpty = false) => {
    return new Proxy({}, {
        get: (_, property) => {
            // console.log(`创建代理对象 ${target}`, property)
            // 最优先从用户设置数据中获取
            if (USER.getSettings()[target] && property in USER.getSettings()[target]) {
                // console.log(`变量 ${property} 已从用户设置中获取`)
                return USER.getSettings()[target][property];
            }
            // 尝试从老版本的数据位置 USER.getExtensionSettings().muyoo_dataTable 中获取
            if (USER.getExtensionSettings()[target] && property in USER.getExtensionSettings()[target]) {
                console.log(`변수 ${property} 사용자 설정에서 찾을 수 없음, 이전 버전 데이터에서 이미 가져옴`)
                const value = USER.getExtensionSettings()[target][property];
                if (!USER.getSettings()[target]) {
                    USER.getSettings()[target] = {}; // 初始化，如果不存在
                }
                USER.getSettings()[target][property] = value;
                return value;
            }
            // 如果 USER.getExtensionSettings().muyoo_dataTable 中也不存在，则从 defaultSettings 中가져오다
            if (USER.tableBaseDefaultSettings && property in USER.tableBaseDefaultSettings) {
                console.log(`변수 ${property} 찾을 수 없음, 기본 설정에서 가져옴`)
                return USER.tableBaseDefaultSettings[property];
            }
            // 如果 defaultSettings 中也不存在，则检查是否允许为空
            if (allowEmpty) {
                return undefined;
            }
            // 如果 defaultSettings 中也不存在，则报错
            EDITOR.error(`변수 ${property} 기본 설정에서 찾을 수 없습니다, 코드를 확인해 주세요`)
            return undefined;
        },
        set: (_, property, value) => {
            console.log(`변수 ${property} 을(를) ${value} (으)로 설정`)
            if (!USER.getSettings()[target]) {
                USER.getSettings()[target] = {}; // 初始化，如果不存在
            }
            USER.getSettings()[target][property] = value;
            USER.saveSettings();
            return true;
        },
    })
}
