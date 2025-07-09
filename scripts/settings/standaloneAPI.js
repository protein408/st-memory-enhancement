// standaloneAPI.js
import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../../core/manager.js';
import LLMApiService from "../../services/llmApi.js";
import {PopupConfirm} from "../../components/popupConfirm.js";

let loadingToast = null;
let currentApiKeyIndex = 0;// 用于记录当前使用的API Key的인덱스


/**
 * 加密
 * @param {*} rawKey - 原始密钥
 * @param {*} deviceId - 设备ID
 * @returns {string} 加密后的字符串
 */
export function encryptXor(rawKey, deviceId) {
    // 处理多个逗号分隔的API Key
    const keys = rawKey.split(',').map(k => k.trim()).filter(k => k.trim().length > 0);
    const uniqueKeys = [...new Set(keys)];
    const uniqueKeyString = uniqueKeys.join(',');

    // 如果有重复Key，返回去重数量和加密后的Key
    if (keys.length !== uniqueKeys.length) {
        return {
            encrypted: Array.from(uniqueKeyString).map((c, i) =>
                c.charCodeAt(0) ^ deviceId.charCodeAt(i % deviceId.length)
            ).map(c => c.toString(16).padStart(2, '0')).join(''),
            duplicatesRemoved: keys.length - uniqueKeys.length
        };
    }

    // 没有重复Key时直接返回加密结果
    return Array.from(uniqueKeyString).map((c, i) =>
        c.charCodeAt(0) ^ deviceId.charCodeAt(i % deviceId.length)
    ).map(c => c.toString(16).padStart(2, '0')).join('');
}

export function processApiKey(rawKey, deviceId) {
    try {
        const keys = rawKey.split(',').map(k => k.trim()).filter(k => k.trim().length > 0);
        const invalidKeysCount = rawKey.split(',').length - keys.length; // 计算无效Key的数量
        const encryptedResult = encryptXor(rawKey, deviceId);
        const totalKeys = rawKey.split(',').length;
        const remainingKeys = totalKeys - (encryptedResult.duplicatesRemoved || 0); // 剩余去掉无效和重复之后Key的数量

        let message = `已업데이트API Key，共${remainingKeys}个Key`;
        if(totalKeys - remainingKeys > 0 || invalidKeysCount > 0){
            const removedParts = [];
            if (totalKeys - remainingKeys > 0) removedParts.push(`${totalKeys - remainingKeys}个重复Key`);
            if (invalidKeysCount > 0) removedParts.push(`${invalidKeysCount}个空值`);
            message += `（已去除${removedParts.join('，')}）`;
        }
        return {
            encryptedResult,
            encrypted: encryptedResult.encrypted,
            duplicatesRemoved: encryptedResult.duplicatesRemoved,
            invalidKeysCount: invalidKeysCount,
            remainingKeys: remainingKeys,
            totalKeys: totalKeys,
            message: message,
        }
    } catch (error) {
        console.error('API Key 处理실패:', error);
        throw error;
    }
}


/**
 * API KEY解密
 * @returns {Promise<string|null>} 解密后的API密钥
 */
export async function getDecryptedApiKey() { // Export this function
    try {
        const encrypted = USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key;
        const deviceId = localStorage.getItem('st_device_id');
        if (!encrypted || !deviceId) return null;

        return await decryptXor(encrypted, deviceId);
    } catch (error) {
        console.error('API Key 복호화 실패:', error);
        return null;
    }
}

/**
 * 해석
 * @param {string} encrypted - 加密字符串
 * @param {string} deviceId - 设备ID
 * @returns {string|null} 해석后的字符串，如果解密실패则返回null
 */
async function decryptXor(encrypted, deviceId) {
    try {
        const bytes = encrypted.match(/.{1,2}/g).map(b =>
            parseInt(b, 16)
        );
        return String.fromCharCode(...bytes.map((b, i) =>
            b ^ deviceId.charCodeAt(i % deviceId.length)
        ));
    } catch(e) {
        console.error('해석 실패:', e);
        return null;
    }
}

async function createLoadingToast(isUseMainAPI = true, isSilent = false) {
    if (isSilent) {
        // 在静默模式下，不显示弹窗，直接模拟“后台继续”
        // 返回 false，因为 PopupConfirm 中“后台继续”按钮（cancelBtn）返回 false
        return Promise.resolve(false);
    }
    loadingToast?.close()
    loadingToast = new PopupConfirm();
    return await loadingToast.show(
        isUseMainAPI
            ? '【주 API】사용 중 테이블 재생성 완료...'
            : '【사용자 정의 API】사용 중 테이블 재생성 완료...',
        '백그라운드에서 계속',
        '실행 중단',
    )
}

/**주 API调用
 * @param {string|Array<object>} systemPrompt - 系统提示或消息数组
 * @param {string} [userPrompt] - 用户提示 (如果第一个参数是消息数组，则此参数被忽略)
 * @param {boolean} [isSilent=false] - 是否以静默模式运行，不显示加载提示
 * @returns {Promise<string>} 生成的响应内容
 */
export async function handleMainAPIRequest(systemPrompt, userPrompt, isSilent = false) {
    let finalSystemPrompt = '';
    let finalUserPrompt = '';
    let suspended = false; // Define suspended outside the blocks

    if (Array.isArray(systemPrompt)) {
        // --- Start: Processing for array input ---
        const messages = systemPrompt; // messages is defined here now

        // Loading toast logic
        createLoadingToast(true, isSilent).then((r) => {
            if (loadingToast) loadingToast.close();
            suspended = r; // Assign to the outer suspended variable
        });

        let startTime = Date.now();
        if (loadingToast) {
            loadingToast.frameUpdate(() => {
                if (loadingToast) {
                    loadingToast.text = `【주 API】사용 중 (다중 메시지) 테이블 재생성 완료: ${((Date.now() - startTime) / 1000).toFixed(1)}초`;
                }
            });
        }

        console.log('주 API 요청의 다중 메시지 배열:', messages); // Log the actual array
        // Use TavernHelper.generateRaw with the array, enabling streaming
        const response = await TavernHelper.generateRaw({
            ordered_prompts: messages, // Pass the array directly
            should_stream: true,      // Re-enable streaming
        });
        loadingToast.close();
        return suspended ? 'suspended' : response;
        // --- End: Processing for array input ---

    } else { // Correctly placed ELSE block
        // --- Start: Original logic for non-array input ---
        finalSystemPrompt = systemPrompt;
        finalUserPrompt = userPrompt;

        createLoadingToast(true, isSilent).then((r) => {
            if (loadingToast) loadingToast.close();
            suspended = r; // Assign to the outer suspended variable
        });

        let startTime = Date.now();
        if (loadingToast) {
            loadingToast.frameUpdate(() => {
                if (loadingToast) {
                    loadingToast.text = `【주 API】사용 중 테이블 재생성 완료: ${((Date.now() - startTime) / 1000).toFixed(1)}초`;
                }
            });
        }

        // Use EDITOR.generateRaw for non-array input
        const response = await EDITOR.generateRaw(
            finalUserPrompt,
            '',
            false,
            false,
            finalSystemPrompt,
        );
        loadingToast.close();
        return suspended ? 'suspended' : response;
        // --- End: Original logic ---
    }
} // Correct closing brace for the function

/**
 * 处理 API 测试请求，包括获取输入、解密密钥、调用测试함수和返回结果。
 * @param {string} apiUrl - API URL.
 * @param {string} encryptedApiKeys - 加密的 API 密钥字符串.
 * @param {string} modelName - 模型名称.
 * @returns {Promise<Array<{keyIndex: number, success: boolean, error?: string}>>} 测试结果数组.
 */
export async function handleApiTestRequest(apiUrl, encryptedApiKeys, modelName) {
    if (!apiUrl || !encryptedApiKeys) {
        EDITOR.error('먼저 API URL과 API Key를 입력해주세요.');
        return []; // 初始验证실패时返回空数组
    }

    const decryptedApiKeysString = await getDecryptedApiKey(); // Use imported function
    if (!decryptedApiKeysString) {
        EDITOR.error('API Key 복호화 실패 또는 설정되지 않음！');
        return []; // 解密실패时返回空数组
    }

    const apiKeys = decryptedApiKeysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
    if (apiKeys.length === 0) {
        EDITOR.error('유효한 API Key를 찾을 수 없습니다');
        return []; // 如果找不到有效的密钥则返回空数组
    }
    const testAll = await EDITOR.callGenericPopup(`${apiKeys.length} 개의 API Key가 감지되었습니다.\n주의：테스트 방식과 Tavern 임포트가 동일하며, 한 번의 메시지를 전송합니다(토큰 수가 적음). 그러나 사용량 기반 API를 사용하는 경우 소비 상황에 유의하십시오.`, EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "테스트 첫 번째 key", cancelButton: "취소" });
    let keysToTest = [];
    if (testAll === null) return []; // 用户取消弹窗，返回空数组

    if (testAll) {
        keysToTest = [apiKeys[0]];
        EDITOR.info(`${keysToTest.length}번째 API Key 테스트 시작...`);
    } else {
        return []; // 用户点击取消，返回空数组
    }
    //！！~~~保留测试多个key的功能，暂时只测试第一个key~~~！！
    try {
        // 调用测试함수
        const results = await testApiConnection(apiUrl, keysToTest, modelName);

        // 处理结果并显示提示消息
        if (results && results.length > 0) {
            EDITOR.clear(); // 清除之前显示的'开始测试第x个API Key...'提示
            let successCount = 0;
            let failureCount = 0;
            results.forEach(result => {
                if (result.success) {
                    successCount++;
                } else {
                    failureCount++;
                    // 记录详细错误，如果可用则使用原始密钥인덱스
                    console.error(`Key ${result.keyIndex !== undefined ? result.keyIndex + 1 : '?'} 테스트 실패: ${result.error}`);
                }
            });

            if (failureCount > 0) {
                EDITOR.error(`${failureCount} 개의 Key 테스트 실패. 자세한 내용은 콘솔을 확인하십시오`);
                EDITOR.error(`API 엔드포인트: ${apiUrl}`);
                EDITOR.error(`오류 상세: ${results.find(r => !r.success)?.error || '알 수 없는 오류'}`);
            }
            if (successCount > 0) {
                EDITOR.success(`${successCount} 개의 Key 테스트 성공！`);
            }
        } else if (results) {
            // 处理testApiConnection可能返回空数组的情况(例如用户取消)
        }

        return results; // 返回结果数组
    } catch (error) {
        EDITOR.error(`API 테스트 과정 중에 발생한 오류`, error.message, error);
        console.error("API Test Error:", error);
        // 发生一般错误时返回一个表示所有테스트 密钥실패的数组
        return keysToTest.map((_, index) => ({
            keyIndex: apiKeys.indexOf(keysToTest[index]), // 如果需要则查找原始인덱스
            success: false,
            error: `테스트 과정 중에 발생한 오류: ${error.message}`
        }));
    }
}

/**
 * 테스트 API连接
 * @param {string} apiUrl - API URL
 * @param {string[]} apiKeys - API密钥数组
 * @param {string} modelName - 模型名称
 * @returns {Promise<Array<{keyIndex: number, success: boolean, error?: string}>>} 테스트 结果数组
 */
export async function testApiConnection(apiUrl, apiKeys, modelName) {
    const results = [];
    const testPrompt = "Say 'test'"; // 테스트 用例

    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = apiKeys[i];
        console.log(`Testing API Key index: ${i}`);
        try {
            const llmService = new LLMApiService({
                api_url: apiUrl,
                api_key: apiKey,
                model_name: modelName || 'gpt-3.5-turbo', // 使用用户设置的模型名称
                system_prompt: 'You are a test assistant.',
                temperature: 0.1 // 使用用户设置的温度
            });

            // 调用API
            const response = await llmService.callLLM(testPrompt);

            if (response && typeof response === 'string') {
                console.log(`API Key index ${i} test successful. Response: ${response}`);
                results.push({ keyIndex: i, success: true });
            } else {
                throw new Error('Invalid or empty response received.');
            }
        } catch (error) {
            console.error(`API Key index ${i} test failed (raw error object):`, error); // Log the raw error object
            let errorMessage = 'Unknown error';
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
            } else if (error && typeof error.toString === 'function') {
                errorMessage = error.toString();
            }
            results.push({ keyIndex: i, success: false, error: errorMessage });
        }
    }
    return results;
}

/**사용자 정의 API调用
 * @param {string|Array<object>} systemPrompt - 系统提示或消息数组
 * @param {string} [userPrompt] - 用户提示 (如果第一个参数是消息数组，则此参数被忽略)
 * @param {boolean} [isStepByStepSummary=false] - 是否为分步总结模式，用于控制流式传输
 * @param {boolean} [isSilent=false] - 是否以静默模式运行，不显示加载提示
 * @returns {Promise<string>} 生成的响应内容
 */
export async function handleCustomAPIRequest(systemPrompt, userPrompt, isStepByStepSummary = false, isSilent = false) {
    const USER_API_URL = USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url;
    const decryptedApiKeysString = await getDecryptedApiKey(); // 获取逗号分隔的密钥字符串
    const USER_API_MODEL = USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name;
    // const MAX_RETRIES = USER.tableBaseSetting.custom_api_retries ?? 0; // 从设置中获取重试次数，默认为 0
    const MAX_RETRIES = 0; // 从设置中获取重试次数，默认为 0

    if (!USER_API_URL || !USER_API_MODEL) {
        EDITOR.error('사용자 정의 API 구성을 모두 입력하십시오 (URL 및 모델)');
        return;
    }

    if (!decryptedApiKeysString) {
        EDITOR.error('API 키 복호화 실패 또는 미설정. API 키 설정을 확인하십시오!');
        return;
    }

    const apiKeys = decryptedApiKeysString.split(',').map(k => k.trim()).filter(k => k.length > 0);

    if (apiKeys.length === 0) {
        EDITOR.error('유효한 API 키를 찾을 수 없습니다. 입력을 확인하십시오.');
        return;
    }

    let suspended = false;
    createLoadingToast(false, isSilent).then((r) => {
        if (loadingToast) loadingToast.close();
        suspended = r;
    })

    const totalKeys = apiKeys.length;
    const attempts = MAX_RETRIES === 0 ? totalKeys : Math.min(MAX_RETRIES, totalKeys);
    let lastError = null;

    for (let i = 0; i < attempts; i++) {
        if (suspended) break; // 检查用户是否中止了 작업

        const keyIndexToTry = currentApiKeyIndex % totalKeys;
        const currentApiKey = apiKeys[keyIndexToTry];
        currentApiKeyIndex++; // 移动到下一个密钥，用于下一次整体请求

        console.log(`API 키 인덱스를 사용하여 API 호출 시도: ${keyIndexToTry}`);
        if (loadingToast) {
            loadingToast.text = `${keyIndexToTry + 1}/${totalKeys} 번째 사용자 정의 API Key를 시도합니다...`;
        }

        try { // Outer try for the whole attempt with the current key
            const promptData = Array.isArray(systemPrompt) ? systemPrompt : userPrompt;
            let response; // Declare response variable

            // --- ALWAYS Use llmService ---
            console.log(`사용자 정의 API: llmService.callLLM 사용 (입력 유형: ${Array.isArray(promptData) ? '다중 메시지 배열' : '단일 메시지'}))`);
            if (loadingToast) {
                loadingToast.text = `현재 ${keyIndexToTry + 1}/${totalKeys} 번째 사용자 정의 API Key (llmService) 사용 중...`;
            }

            const llmService = new LLMApiService({
                api_url: USER_API_URL,
                api_key: currentApiKey,
                model_name: USER_API_MODEL,
                // Pass empty system_prompt if promptData is array, otherwise pass the original systemPrompt string
                system_prompt: Array.isArray(promptData) ? "" : systemPrompt,
                temperature: USER.tableBaseSetting.custom_temperature,
                table_proxy_address: USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address,
                table_proxy_key: USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_key
            });

            const streamCallback = (chunk) => {
                if (loadingToast) {
                    const modeText = isStepByStepSummary ? "(단계별)" : ""; // isStepByStepSummary might be useful here still
                    loadingToast.text = `${keyIndexToTry + 1}번째 Key를 사용하여 생성 중입니다. ${modeText}: ${chunk}`;
                }
            };

            try {
                // Pass promptData (which could be string or array) to callLLM
                response = await llmService.callLLM(promptData, streamCallback);
                console.log(`요청 성공 (llmService, key 인덱스: ${keyIndexToTry}):`, response);
                loadingToast?.close();
                return suspended ? 'suspended' : response; // Success, return immediately
            } catch (llmServiceError) {
                // llmService failed, log error and continue loop
                console.error(`API 호출 실패 (llmService)，key 인덱스 ${keyIndexToTry}:`, llmServiceError);
                lastError = llmServiceError;
                EDITOR.error(`사용한 ${keyIndexToTry + 1} 번째 Key 호출 (llmService) 실패: ${llmServiceError.message || '알 수 없는 오류'}`);
                // Let the loop continue to the next key
            }
            // If code reaches here, the llmService call failed for this key

        } catch (error) { // This catch should ideally not be reached due to inner try/catch
            console.error(`키 인덱스 ${keyIndexToTry} 처리 중 예상치 못한 오류가 발생했습니다:`, error);
            lastError = error;
            EDITOR.error(`${keyIndexToTry + 1} 번째의 Key 처리 중 예기치 않은 오류 발생`, error.message || '알 수 없는 오류', error);
        }
    }

    // 所有尝试均실패
    loadingToast?.close();
    if (suspended) {
        EDITOR.warning('사용자로부터 작업이 중지되었습니다');
        return 'suspended';
    }

    const errorMessage = `모든 ${attempts} 회 시도가 실패했습니다. 마지막 오류: ${lastError?.message || '알 수 없는 오류'}`;
    EDITOR.error(errorMessage, "", lastError);
    console.error('모든 API 호출 시도가 실패했습니다.', lastError);
    return `오류: ${errorMessage}`; // 返回一个明确的错误字符串

    // // 公共请求配置 (Commented out original code remains unchanged)
    // const requestConfig = {
    //     method: 'POST',
    //     headers: {
    //         'Content-Type': 'application/json',
    //         'Authorization': `Bearer ${USER_API_KEY}`
    //     },
    //     body: JSON.stringify({
    //         model: USER_API_MODEL,
    //         messages: [
    //             { role: "system", content: systemPrompt },
    //             { role: "user", content: userPrompt }
    //         ],
    //         temperature: USER.tableBaseSetting.custom_temperature
    //     })
    // };
    //
    // // 通用请求함수
    // const makeRequest = async (url) => {
    //     const response = await fetch(url, requestConfig);
    //     if (!response.ok) {
    //         const errorBody = await response.text();
    //         throw { status: response.status, message: errorBody };
    //     }
    //     return response.json();
    // };
    // let firstError;
    // try {
    //     // 第一次尝试补全/chat/completions
    //     const modifiedUrl = new URL(USER_API_URL);
    //     modifiedUrl.pathname = modifiedUrl.pathname.replace(/\/$/, '') + '/chat/completions';
    //     const result = await makeRequest(modifiedUrl.href);
    //     if (result?.choices?.[0]?.message?.content) {
    //         console.log('请求성공:', result.choices[0].message.content)
    //         return result.choices[0].message.content;
    //     }
    // } catch (error) {
    //     firstError = error;
    // }
    //
    // try {
    //     // 第二次尝试原始URL
    //     const result = await makeRequest(USER_API_URL);
    //     return result.choices[0].message.content;
    // } catch (secondError) {
    //     const combinedError = new Error('API请求실패');
    //     combinedError.details = {
    //         firstAttempt: firstError?.message || '第一次请求无错误信息',
    //         secondAttempt: secondError.message
    //     };
    //     throw combinedError;
    // }
}

/**请求模型열테이블
 * @returns {Promise<void>}
 */
/**
 * 格式化API Key用于错误提示
 * @param {string} key - API Key
 * @returns {string} 格式化后的Key字符串
 */
function maskApiKey(key) {
    const len = key.length;
    if (len === 0) return "[빈 Key]";
    if (len <= 8) {
        const visibleCount = Math.ceil(len / 2);
        return key.substring(0, visibleCount) + '...';
    } else {
        return key.substring(0, 4) + '...' + key.substring(len - 4);
    }
}

/**请求模型열테이블
 * @returns {Promise<void>}
 */
export async function updateModelList() {
    const apiUrl = $('#custom_api_url').val().trim();
    const decryptedApiKeysString = await getDecryptedApiKey(); // 使用 getDecryptedApiKey 함수解密

    if (!decryptedApiKeysString) {
        EDITOR.error('API 키 복호화 실패 또는 미설정. API 키 설정을 확인하십시오!');
        return;
    }
    if (!apiUrl) {
        EDITOR.error('API URL을 입력하십시오');
        return;
    }

    const apiKeys = decryptedApiKeysString.split(',').map(k => k.trim()).filter(k => k.length > 0);

    if (apiKeys.length === 0) {
        EDITOR.error('유효한 API 키를 찾을 수 없습니다. 입력을 확인하십시오.');
        return;
    }

    let foundValidKey = false;
    const invalidKeysInfo = [];
    let modelCount = 0; // 用于记录获取到的模型数量
    const $selector = $('#model_selector');

    // 规范化URL路径
    let modelsUrl;
    try {
        const normalizedUrl = new URL(apiUrl);
        normalizedUrl.pathname = normalizedUrl.pathname.replace(/\/$/, '') + '/models';
        modelsUrl = normalizedUrl.href;
    } catch (e) {
        EDITOR.error(`유효하지 않은 API URL: ${apiUrl}`, "", e);
        console.error('URL 파싱 실패:', e);
        return;
    }

    for (let i = 0; i < apiKeys.length; i++) {
        const currentApiKey = apiKeys[i];
        try {
            const response = await fetch(modelsUrl, {
                headers: {
                    'Authorization': `Bearer ${currentApiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                let errorMsg = `요청 실패: ${response.status}`;
                try {
                    const errorBody = await response.text();
                    errorMsg += ` - ${errorBody}`;
                } catch {}
                throw new Error(errorMsg);
            }

            const data = await response.json();

            // 只有在第一次성공获取时才업데이트下拉框
            if (!foundValidKey && data?.data?.length > 0) {
                $selector.empty(); // 清空现有选项
                const customModelName = USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name;
                let hasMatchedModel = false;

                data.data.forEach(model => {
                    $selector.append($('<option>', {
                        value: model.id,
                        text: model.id
                    }));

                    // 检查是否有模型名称与custom_model_name匹配
                    if (model.id === customModelName) {
                        hasMatchedModel = true;
                    }
                });

                // 如果有匹配的模型，则选中它
                if (hasMatchedModel) {
                    $selector.val(customModelName);
                }

                foundValidKey = true;
                modelCount = data.data.length; // 记录模型数量
                // 不在此处显示성공消息，统一在最后处理
            } else if (!foundValidKey && (!data?.data || data.data.length === 0)) {
                 // 即使请求成功，但没有模型数据，也视为一种失败情况，记录下来
                 throw new Error('요청 성공했지만 유효한 모델 열 테이블을 반환하지 않았습니다');
            }
            // 如果已经找到有效key并업데이트了열테이블，后续的key只做有效性检查，不再업데이트UI

        } catch (error) {
            console.error(`${i + 1} 번째 사용 Key의 모델 가져오기 실패:`, error);
            invalidKeysInfo.push({ index: i + 1, key: currentApiKey, error: error.message });
        }
    }

    // 处理最终结果和错误提示
    if (foundValidKey) {
        EDITOR.success(`성공적으로 ${modelCount} 개의 모델을 가져오고 열 테이블을 업데이트했습니다 (총 ${apiKeys.length} 개의 Key 확인)`);
    } else {
        EDITOR.error('제공된 API Key 중 하나를 사용하여 열 테이블을 가져오지 못했습니다');
        $selector.empty(); // 确保在所有key都无效时清空열테이블
        $selector.append($('<option>', { value: '', text: '모델 열 테이블을 가져오지 못했습니다' }));
    }

    if (invalidKeysInfo.length > 0) {
        const errorDetails = invalidKeysInfo.map(item =>
            `${item.index}번째 Key의 (${maskApiKey(item.key)}) 무효: ${item.error}`
        ).join('\n');
        EDITOR.error(`다음 API Key 무효:\n${errorDetails}`);
    }
}
/**
 * 估算 Token 数量
 * @param {string} text - 要估算 token 数量的文本
 * @returns {number} 估算的 token 数量
 */
export function estimateTokenCount(text) {
    // 统计中文字符数量
    let chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;

    // 统计英文单词数量
    let englishWords = text.match(/\b\w+\b/g) || [];
    let englishCount = englishWords.length;

    // 估算 token 数量
    let estimatedTokenCount = chineseCount + Math.floor(englishCount * 1.2);
    return estimatedTokenCount;
}
/**
 * @description
 * - **功能**: 导出所有테이블 데이터，方便其他插件调用。
 * - **使用场景**: 当其他插件需要访问或处理当前插件管理的테이블 데이터时，可以通过此함수获取。
 * - **返回值**: 返回一个包含所有테이블 데이터的数组，每个테이블对象包含：
 *   - `name`: 테이블的名称。
 *   - `data`: 一个二维数组，表示테이블的完整数据（包括테이블头和所有行）。
 *
 * @returns {Array<Object<{name: string, data: Array<Array<string>>}>>}
 */
export function ext_getAllTables() {
    // 核心重构：与 ext_exportAllTablesAsJson 保持一致，确保数据源是最新的持久化状态。
    
    // 1. 获取最新的 piece
    const { piece } = BASE.getLastSheetsPiece();
    if (!piece || !piece.hash_sheets) {
        console.warn("[Memory Enhancement] ext_getAllTables: 유효한 테이블 데이터가 없습니다.");
        return [];
    }

    // 2. 基于最新的 hash_sheets 创建/업데이트 Sheet 实例
    const tables = BASE.hashSheetsToSheets(piece.hash_sheets);
    if (!tables || tables.length === 0) {
        return [];
    }
    
    // 3. 遍历最新的实例构建数据
    const allData = tables.map(table => {
        if (!table.enable) return null; // 跳过禁用的테이블
        const header = table.getHeader();
        const body = table.getBody();
        const fullData = [header, ...body];

        return {
            name: table.name,
            data: fullData,
        };
    }).filter(Boolean); // 过滤掉 null (禁用的테이블)

    return allData;
}

/**
 * @description
 * - **功能**: 导出所有테이블为一个 JSON 对象，格式与 '范例테이블.json' 类似。
 * - **使用场景**: 用于将当前所有테이블的状态和数据导出为一个单一的 JSON 文件。
 * - **返回值**: 返回一个 JSON 对象，键是테이블的 UID，值是테이블的完整配置和数据。
 *
 * @returns {Object}
 */
export function ext_exportAllTablesAsJson() {
    // 最终、最稳妥的方案：确保输入给 JSON.stringify 的数据是纯净的。

    const { piece } = BASE.getLastSheetsPiece();
    if (!piece || !piece.hash_sheets) {
        console.warn("[Memory Enhancement] ext_exportAllTablesAsJson: 유효한 테이블 데이터가 없습니다.");
        return {};
    }

    const tables = BASE.hashSheetsToSheets(piece.hash_sheets);
    if (!tables || tables.length === 0) {
        return {};
    }

    const exportData = {};
    tables.forEach(table => {
        if (!table.enable) return; // 跳过禁用的테이블

        try {
            const rawContent = table.getContent(true) || [];

            // 深度清洗，确保所有单元格都是字符串类型。
            // 这是防止因 undefined、null 或其他非字符串类型导致 JSON.stringify 行为异常的关键。
            const sanitizedContent = rawContent.map(row =>
                Array.isArray(row) ? row.map(cell =>
                    String(cell ?? '') // 将 null 和 undefined 转换为空字符串，其他类型强制转换为字符串
                ) : []
            );

            exportData[table.uid] = {
                uid: table.uid,
                name: table.name,
                content: sanitizedContent
            };
        } catch (error) {
            console.error(`[Memory Enhancement] ${table.name} (UID: ${table.uid}) 테이블 내보내기 중 오류 발생:`, error);
        }
    });

    // 直接序열化整个清洗过的对象。
    // 如果这里依然出错，说明问题比预想的更复杂，但理论上这已经是JS中最标准的做法。
    try {
        // 为了避免外层宏파싱실패，我们直接返回字符串，让宏自己去파싱。
        return exportData;
    } catch (e) {
        console.error("[Memory Enhancement] 최종 JSON 직렬화 실패:", e);
        return {}; // 发生意外时返回空对象
    }
}
