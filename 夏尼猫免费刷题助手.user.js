// ==UserScript==
// @name         夏尼猫免费刷题助手
// @namespace    http://tampermonkey.net/
// @version      1.0.2
// @description  智能自动答题助手，支持DeepSeek AI，提供高准确率的答题服务，可在任何网站运行
// @author       夏尼猫
// @match        *://*/*
// @match        http://*/*
// @match        https://*/*
// @match        file://*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_log
// @grant        unsafeWindow
// @connect      api.deepseek.com
// @connect      *.deepseek.com
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @run-at       document-end
// @updateURL    none
// @downloadURL  none
// ==/UserScript==

(function() {
    'use strict';

    // 配置常量
    const CONFIG = {
        DEFAULT_API_URL: 'https://api.deepseek.com/v1/chat/completions',
        DEFAULT_API_KEY: '', // 用户需要设置自己的API Key
        MODELS: {
            REASONER: 'deepseek-reasoner',
            CHAT: 'deepseek-chat'
        },
        COLORS: {
            PRIMARY: '#4A90E2',
            SUCCESS: '#7ED321',
            WARNING: '#F5A623',
            ERROR: '#D0021B',
            BACKGROUND: '#F8F9FA',
            CARD: '#FFFFFF',
            TEXT: '#333333',
            BORDER: '#E1E5E9'
        }
    };

    // 全局状态管理
    const state = {
        isRunning: false,
        currentQuestion: 0,
        totalQuestions: 0,
        correctAnswers: 0,
        apiKey: GM_getValue('deepseek_api_key', ''),
        apiUrl: GM_getValue('deepseek_api_url', CONFIG.DEFAULT_API_URL),
        selectedModel: GM_getValue('selected_model', CONFIG.MODELS.CHAT),
        authCode: GM_getValue('shanmao_auth_code', ''),
        isAuthorized: GM_getValue('shanmao_is_authorized', false),
        logs: [],
        questions: []
    };

    // 日志系统
    const Logger = {
        log(message, type = 'info') {
            const timestamp = new Date().toLocaleTimeString();
            const logEntry = {
                timestamp,
                message,
                type,
                id: Date.now()
            };
            state.logs.unshift(logEntry);
            if (state.logs.length > 100) {
                state.logs = state.logs.slice(0, 100);
            }
            this.updateLogDisplay();
        },

        updateLogDisplay() {
            const logContainer = document.getElementById('shanmao-log-container');
            if (!logContainer) return;

            logContainer.innerHTML = state.logs.map(log => `
                <div class="shanmao-log-item shanmao-log-${log.type}">
                    <span class="shanmao-log-time">${log.timestamp}</span>
                    <span class="shanmao-log-message">${log.message}</span>
                </div>
            `).join('');
        },

        info(message) { this.log(message, 'info'); },
        success(message) { this.log(message, 'success'); },
        warning(message) { this.log(message, 'warning'); },
        error(message) { this.log(message, 'error'); }
    };

    // 题目提取器
    const QuestionExtractor = {
        extractQuestions() {
            const questions = [];
            
            // 提取单选题
            document.querySelectorAll('.singItem').forEach((element, index) => {
                const question = this.extractSingleChoice(element, index);
                if (question) questions.push(question);
            });

            // 提取多选题
            document.querySelectorAll('.Mutli').forEach((element, index) => {
                const question = this.extractMultipleChoice(element, index);
                if (question) questions.push(question);
            });

            // 提取填空题
            document.querySelectorAll('.blanking').forEach((element, index) => {
                const question = this.extractBlankFilling(element, index);
                if (question) questions.push(question);
            });

            // 提取判断题
            document.querySelectorAll('.judge').forEach((element, index) => {
                const question = this.extractJudgement(element, index);
                if (question) questions.push(question);
            });

            // 提取复合题
            document.querySelectorAll('[data-answer-mode="Composite"]').forEach((element, index) => {
                const question = this.extractComposite(element, index);
                if (question) questions.push(question);
            });

            Logger.info(`成功提取 ${questions.length} 道题目`);
            return questions;
        },

        extractSingleChoice(element, index) {
            try {
                const questionText = this.getQuestionText(element);
                const options = this.getOptions(element);
                const questionId = element.getAttribute('id') || `single_${index}`;

                return {
                    id: questionId,
                    type: 'single',
                    question: questionText,
                    options: options,
                    element: element,
                    index: index
                };
            } catch (error) {
                Logger.error(`提取单选题失败: ${error.message}`);
                return null;
            }
        },

        extractMultipleChoice(element, index) {
            try {
                const questionText = this.getQuestionText(element);
                const options = this.getOptions(element);
                const questionId = element.getAttribute('id') || `multiple_${index}`;

                return {
                    id: questionId,
                    type: 'multiple',
                    question: questionText,
                    options: options,
                    element: element,
                    index: index
                };
            } catch (error) {
                Logger.error(`提取多选题失败: ${error.message}`);
                return null;
            }
        },

        extractBlankFilling(element, index) {
            try {
                const questionText = this.getQuestionText(element);
                const blanks = element.querySelectorAll('.bankContent');
                const questionId = element.getAttribute('id') || `blank_${index}`;

                return {
                    id: questionId,
                    type: 'blank',
                    question: questionText,
                    blanks: Array.from(blanks),
                    element: element,
                    index: index
                };
            } catch (error) {
                Logger.error(`提取填空题失败: ${error.message}`);
                return null;
            }
        },

        extractJudgement(element, index) {
            try {
                const questionText = this.getQuestionText(element);
                const questionId = element.getAttribute('id') || `judge_${index}`;

                return {
                    id: questionId,
                    type: 'judgement',
                    question: questionText,
                    element: element,
                    index: index
                };
            } catch (error) {
                Logger.error(`提取判断题失败: ${error.message}`);
                return null;
            }
        },

        extractComposite(element, index) {
            try {
                const questionText = this.getQuestionText(element);
                const subQuestions = [];
                
                element.querySelectorAll('.subItem').forEach((subElement, subIndex) => {
                    const subQuestion = this.extractSubQuestion(subElement, subIndex);
                    if (subQuestion) subQuestions.push(subQuestion);
                });

                const questionId = element.getAttribute('id') || `composite_${index}`;

                return {
                    id: questionId,
                    type: 'composite',
                    question: questionText,
                    subQuestions: subQuestions,
                    element: element,
                    index: index
                };
            } catch (error) {
                Logger.error(`提取复合题失败: ${error.message}`);
                return null;
            }
        },

        extractSubQuestion(element, index) {
            // 根据子题类型提取
            if (element.closest('.singItem')) {
                return this.extractSingleChoice(element, index);
            } else if (element.closest('.Mutli')) {
                return this.extractMultipleChoice(element, index);
            } else if (element.closest('.blanking')) {
                return this.extractBlankFilling(element, index);
            } else if (element.closest('.judge')) {
                return this.extractJudgement(element, index);
            }
            return null;
        },

        getQuestionText(element) {
            // 多种方式提取题目文本
            let questionText = '';
            
            // 方式1: 查找题干区域
            const stemElement = element.querySelector('.question-stem, .stem, dt');
            if (stemElement) {
                questionText = this.cleanText(stemElement.textContent);
            }

            // 方式2: 查找第一个div
            if (!questionText) {
                const firstDiv = element.querySelector('div');
                if (firstDiv) {
                    questionText = this.cleanText(firstDiv.textContent);
                }
            }

            // 方式3: 直接获取元素文本（排除选项）
            if (!questionText) {
                const clone = element.cloneNode(true);
                const options = clone.querySelectorAll('dd, .option');
                options.forEach(option => option.remove());
                questionText = this.cleanText(clone.textContent);
            }

            return questionText;
        },

        getOptions(element) {
            const options = [];
            const optionElements = element.querySelectorAll('dd, .option');
            
            optionElements.forEach((option, index) => {
                const text = this.cleanText(option.textContent);
                const label = String.fromCharCode(65 + index); // A, B, C, D...
                
                options.push({
                    label: label,
                    text: text,
                    element: option
                });
            });

            return options;
        },

        cleanText(text) {
            return text.replace(/\s+/g, ' ').trim();
        }
    };

    // 授权验证系统
    const AuthManager = {
        // 正确的授权码
        VALID_AUTH_CODE: 'xnm_cp',
        
        // 验证授权码
        verifyAuthCode(inputCode) {
            const isValid = inputCode === this.VALID_AUTH_CODE;
            if (isValid) {
                state.authCode = inputCode;
                state.isAuthorized = true;
                GM_setValue('shanmao_auth_code', inputCode);
                GM_setValue('shanmao_is_authorized', true);
                Logger.success('授权验证成功！');
                this.updateAuthUI(true);
                this.showAPISection();
            } else {
                state.authCode = '';
                state.isAuthorized = false;
                GM_setValue('shanmao_auth_code', '');
                GM_setValue('shanmao_is_authorized', false);
                Logger.error('授权码错误，请检查后重试');
                this.updateAuthUI(false);
                this.hideAPISection();
            }
            return isValid;
        },
        
        // 更新授权状态UI
        updateAuthUI(isAuthorized) {
            const statusDiv = document.getElementById('shanmao-auth-status');
            if (statusDiv) {
                statusDiv.style.display = 'block';
                if (isAuthorized) {
                    statusDiv.style.backgroundColor = '#d4edda';
                    statusDiv.style.color = '#155724';
                    statusDiv.style.border = '1px solid #c3e6cb';
                    statusDiv.innerHTML = '✅ 授权验证成功，可以正常使用所有功能';
                } else {
                    statusDiv.style.backgroundColor = '#f8d7da';
                    statusDiv.style.color = '#721c24';
                    statusDiv.style.border = '1px solid #f5c6cb';
                    statusDiv.innerHTML = '❌ 授权验证失败，请输入正确的授权码';
                }
            }
        },
        
        // 显示API配置区域
        showAPISection() {
            const apiSection = document.getElementById('shanmao-api-section');
            if (apiSection) {
                apiSection.style.display = 'block';
            }
        },
        
        // 隐藏API配置区域
        hideAPISection() {
            const apiSection = document.getElementById('shanmao-api-section');
            if (apiSection) {
                apiSection.style.display = 'none';
            }
        },
        
        // 检查是否已授权
        checkAuthorization() {
            if (state.isAuthorized && state.authCode === this.VALID_AUTH_CODE) {
                this.updateAuthUI(true);
                this.showAPISection();
                return true;
            } else {
                // 如果状态不一致，清理本地存储
                if (state.isAuthorized || state.authCode) {
                    state.authCode = '';
                    state.isAuthorized = false;
                    GM_setValue('shanmao_auth_code', '');
                    GM_setValue('shanmao_is_authorized', false);
                }
                this.updateAuthUI(false);
                this.hideAPISection();
                return false;
            }
        },
        
        // 显示二维码引导
        showQRCodeGuide() {
            const qrModal = document.createElement('div');
            qrModal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.8);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
                animation: fadeIn 0.3s ease-in-out;
            `;
            
            qrModal.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 15px; text-align: center; max-width: 450px; position: relative; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                    <button onclick="this.parentElement.parentElement.remove()" style="position: absolute; top: 15px; right: 20px; background: none; border: none; font-size: 24px; cursor: pointer; color: #999; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">×</button>
                    
                    <div style="margin-bottom: 25px;">
                        <h3 style="margin: 0 0 10px 0; color: #333; font-size: 20px;">🔐 获取授权码</h3>
                        <p style="margin: 0; color: #666; font-size: 14px;">关注公众号获取免费授权码</p>
                    </div>
                    
                    <div style="margin-bottom: 25px;">
                        <div style="width: 200px; height: 200px; margin: 0 auto 15px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); overflow: hidden; position: relative;">
                            <img src="http://api.2016xlx.cn/img/fjtsvjddfk.jpg" alt="夏尼猫公众号二维码" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.innerHTML='<div style=\\'display: flex; align-items: center; justify-content: center; height: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center;\\'>📱<br>微信扫码关注<br>夏尼猫公众号</div>'">
                        </div>
                        <p style="margin: 0; color: #666; font-size: 14px; font-weight: bold;">扫码关注"夏尼猫"公众号</p>
                    </div>
                    
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h4 style="margin: 0 0 15px 0; color: #333; font-size: 16px;">📋 获取步骤</h4>
                        <div style="text-align: left; color: #666; font-size: 14px; line-height: 1.8;">
                            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                <span style="background: #4A90E2; color: white; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; margin-right: 10px;">1</span>
                                微信扫描上方二维码
                            </div>
                            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                <span style="background: #4A90E2; color: white; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; margin-right: 10px;">2</span>
                                关注"夏尼猫"公众号
                            </div>
                            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                <span style="background: #4A90E2; color: white; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; margin-right: 10px;">3</span>
                                回复关键词"<strong style="color: #4A90E2;">授权码</strong>"
                            </div>
                            <div style="display: flex; align-items: center;">
                                <span style="background: #4A90E2; color: white; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; margin-right: 10px;">4</span>
                                复制授权码到输入框验证
                            </div>
                        </div>
                    </div>
                    
                    <div style="background: #e8f4fd; border: 1px solid #bee5eb; padding: 15px; border-radius: 8px; font-size: 13px; color: #0c5460;">
                        <div style="font-weight: bold; margin-bottom: 5px;">💡 温馨提示</div>
                        <div>• 授权码完全免费，用于验证用户身份</div>
                        <div>• 一个授权码可在多个设备使用</div>
                        <div>• 如有问题可在公众号内咨询客服</div>
                    </div>
                </div>
                
                <style>
                    @keyframes fadeIn {
                        from { opacity: 0; transform: scale(0.9); }
                        to { opacity: 1; transform: scale(1); }
                    }
                </style>
            `;
            
            document.body.appendChild(qrModal);
            
            // 点击背景关闭
            qrModal.addEventListener('click', (e) => {
                if (e.target === qrModal) {
                    qrModal.remove();
                }
            });
        }
    };

    // DeepSeek API 调用
    const DeepSeekAPI = {
        async getAnswer(question, model = state.selectedModel) {
            // 授权验证
            if (!state.isAuthorized || state.authCode !== AuthManager.VALID_AUTH_CODE) {
                throw new Error('请先完成授权验证，关注公众号"夏尼猫"获取授权码');
            }
            
            // API Key验证
            if (!state.apiKey) {
                throw new Error('请先设置 API Key');
            }

            if (state.apiKey.length < 10) {
                throw new Error('API Key长度不正确，请检查是否完整');
            }

            // 验证API URL
            if (!state.apiUrl || !state.apiUrl.startsWith('https://')) {
                throw new Error('API URL格式不正确，应该以"https://"开头');
            }

            // 验证模型参数
            const validModels = ['deepseek-chat', 'deepseek-reasoner'];
            if (model && !validModels.includes(model)) {
                Logger.warning(`未知模型: ${model}，使用默认模型 deepseek-chat`);
                model = 'deepseek-chat';
            }

            const prompt = this.buildPrompt(question);
            
            // 调试日志
            Logger.info(`准备发送API请求: ${state.apiUrl}`);
            Logger.info(`使用模型: ${model || 'deepseek-chat'}`);
            Logger.info(`API Key前缀: ${state.apiKey.substring(0, 8)}...`);
            Logger.info(`请求数据大小: ${JSON.stringify({model, messages: [{role: 'system', content: '...'}, {role: 'user', content: prompt}]}).length} 字节`);
            
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: state.apiUrl,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.apiKey}`,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    },
                    timeout: 30000, // 30秒超时
                    data: JSON.stringify({
                        model: model || 'deepseek-chat',
                        messages: [
                            {
                                role: 'system',
                                content: '你是一个专业的答题助手，请根据题目内容给出准确的答案。对于选择题，请直接给出选项字母；对于填空题，请给出具体答案；对于判断题，请回答"正确"或"错误"。'
                            },
                            {
                                role: 'user',
                                content: prompt
                            }
                        ],
                        temperature: 0.1,
                        max_tokens: 1000,
                        stream: false
                    }),
                    onload: function(response) {
                        Logger.info(`收到API响应: HTTP ${response.status}`);
                        try {
                            // 检查HTTP状态码
                            if (response.status !== 200) {
                                Logger.error(`HTTP错误: ${response.status} - ${response.statusText}`);
                                reject(new Error(`API 请求失败: HTTP ${response.status} - ${response.statusText || '未知错误'}`));
                                return;
                            }

                            const data = JSON.parse(response.responseText);
                            if (data.error) {
                                Logger.error(`API错误: ${JSON.stringify(data.error)}`);
                                reject(new Error(`API 错误: ${data.error.message || data.error.type || '未知API错误'}`));
                                return;
                            }

                            if (data.choices && data.choices[0]) {
                                Logger.success('API请求成功，收到有效响应');
                                resolve(data.choices[0].message.content);
                            } else {
                                Logger.error('API响应格式异常: ' + JSON.stringify(data));
                                reject(new Error('API 响应格式错误: 未找到有效的回答内容'));
                            }
                        } catch (error) {
                            Logger.error(`响应解析失败: ${error.message}`);
                            reject(new Error('解析 API 响应失败: ' + (error.message || '未知解析错误')));
                        }
                    },
                    onerror: function(error) {
                        Logger.error(`网络请求失败: ${JSON.stringify(error)}`);
                        Logger.error(`错误详情: readyState=${error.readyState}, status=${error.status}, statusText=${error.statusText}`);
                        
                        let errorMsg = '网络连接失败';
                        let troubleshootingTips = '';
                        
                        // 特殊处理：status=0但有响应头的情况（通常是认证问题）
                        if (error.status === 0 && error.responseHeaders) {
                            Logger.warning('检测到服务器响应但状态码为0，可能是认证失败');
                            
                            // 检查响应头中的具体信息
                            const headers = error.responseHeaders.toLowerCase();
                            if (headers.includes('access-control-allow-credentials')) {
                                errorMsg = 'API认证失败，请检查API Key是否正确';
                                troubleshootingTips = '\n🔧 故障排除建议:\n1. 确认API Key格式正确\n2. 检查API Key是否有效且未过期\n3. 确认账户余额充足\n4. 尝试重新生成API Key';
                            } else if (headers.includes('content-type: application/json')) {
                                // 服务器返回了JSON响应但状态码为0，可能是CORS问题
                                errorMsg = 'CORS策略阻止了请求，这可能是浏览器安全限制';
                                troubleshootingTips = '\n🔧 故障排除建议:\n1. 确保Tampermonkey脚本权限正确\n2. 检查@connect配置\n3. 尝试刷新页面重新加载脚本';
                            } else {
                                errorMsg = '服务器拒绝请求，可能是API Key无效或已过期';
                                troubleshootingTips = '\n🔧 故障排除建议:\n1. 验证API Key有效性\n2. 检查账户状态\n3. 确认API服务可用性';
                            }
                        } else if (error.status === 0) {
                            errorMsg = '无法连接到服务器 (可能是CORS或网络问题)';
                            troubleshootingTips = '\n🔧 故障排除建议:\n1. 检查网络连接\n2. 确认防火墙设置\n3. 验证Tampermonkey权限配置';
                        } else if (error.status === 401) {
                            errorMsg = 'API Key认证失败，请检查API Key是否正确';
                            troubleshootingTips = '\n🔧 故障排除建议:\n1. 重新检查API Key格式\n2. 确认API Key未过期\n3. 验证账户权限';
                        } else if (error.status === 403) {
                            errorMsg = 'API访问被拒绝，请检查API Key权限';
                            troubleshootingTips = '\n🔧 故障排除建议:\n1. 检查API Key权限范围\n2. 确认账户状态正常\n3. 联系API服务提供商';
                        } else if (error.status === 429) {
                            errorMsg = 'API请求频率过高，请稍后重试';
                            troubleshootingTips = '\n🔧 故障排除建议:\n1. 等待1-2分钟后重试\n2. 检查账户配额限制\n3. 考虑升级API套餐';
                        } else if (error.statusText) {
                            errorMsg = error.statusText;
                        } else if (error.message) {
                            errorMsg = error.message;
                        }
                        
                        reject(new Error('API 请求失败: ' + errorMsg + troubleshootingTips));
                    },
                    ontimeout: function() {
                        Logger.error('API请求超时');
                        reject(new Error('API 请求超时，请检查网络连接'));
                    }
                });
            });
        },

        buildPrompt(question) {
            let prompt = `题目: ${question.question}\n\n`;

            switch (question.type) {
                case 'single':
                    prompt += '这是一道单选题，选项如下:\n';
                    question.options.forEach(option => {
                        prompt += `${option.label}. ${option.text}\n`;
                    });
                    prompt += '\n请直接回答选项字母（如：A）';
                    break;

                case 'multiple':
                    prompt += '这是一道多选题，选项如下:\n';
                    question.options.forEach(option => {
                        prompt += `${option.label}. ${option.text}\n`;
                    });
                    prompt += '\n请回答所有正确的选项字母，用逗号分隔（如：A,C,D）';
                    break;

                case 'blank':
                    prompt += '这是一道填空题，请给出填空答案。如果有多个空，请用"|"分隔';
                    break;

                case 'judgement':
                    prompt += '这是一道判断题，请回答"正确"或"错误"';
                    break;

                default:
                    prompt += '请根据题目内容给出答案';
            }

            return prompt;
        }
    };

    // 自动答题器
    const AutoAnswerer = {
        async answerQuestion(question) {
            try {
                Logger.info(`正在解答第 ${state.currentQuestion + 1} 题: ${question.question.substring(0, 50)}...`);
                
                const answer = await DeepSeekAPI.getAnswer(question);
                Logger.info(`AI 回答: ${answer}`);

                switch (question.type) {
                    case 'single':
                        this.answerSingleChoice(question, answer);
                        break;
                    case 'multiple':
                        this.answerMultipleChoice(question, answer);
                        break;
                    case 'blank':
                        this.answerBlankFilling(question, answer);
                        break;
                    case 'judgement':
                        this.answerJudgement(question, answer);
                        break;
                    case 'composite':
                        await this.answerComposite(question, answer);
                        break;
                }

                state.correctAnswers++;
                Logger.success(`第 ${state.currentQuestion + 1} 题答题完成`);
                
            } catch (error) {
                Logger.error(`第 ${state.currentQuestion + 1} 题答题失败: ${error.message}`);
            }
        },

        answerSingleChoice(question, answer) {
            const selectedOption = answer.trim().toUpperCase();
            const optionIndex = selectedOption.charCodeAt(0) - 65; // A=0, B=1, C=2...
            
            if (optionIndex >= 0 && optionIndex < question.options.length) {
                const optionElement = question.options[optionIndex].element;
                this.clickElement(optionElement);
            }
        },

        answerMultipleChoice(question, answer) {
            const selectedOptions = answer.split(',').map(opt => opt.trim().toUpperCase());
            
            selectedOptions.forEach(option => {
                const optionIndex = option.charCodeAt(0) - 65;
                if (optionIndex >= 0 && optionIndex < question.options.length) {
                    const optionElement = question.options[optionIndex].element;
                    this.clickElement(optionElement);
                }
            });
        },

        answerBlankFilling(question, answer) {
            const answers = answer.split('|').map(ans => ans.trim());
            
            question.blanks.forEach((blank, index) => {
                if (answers[index]) {
                    const input = blank.querySelector('textarea, input');
                    if (input) {
                        input.value = answers[index];
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            });
        },

        answerJudgement(question, answer) {
            const isCorrect = answer.includes('正确') || answer.includes('对') || answer.toLowerCase().includes('true');
            const buttons = question.element.querySelectorAll('input[type="button"]');
            
            buttons.forEach(button => {
                const buttonText = button.value;
                if ((isCorrect && (buttonText.includes('正确') || buttonText.includes('对'))) ||
                    (!isCorrect && (buttonText.includes('错误') || buttonText.includes('错')))) {
                    this.clickElement(button);
                }
            });
        },

        async answerComposite(question, answer) {
            // 复合题需要逐个处理子题
            for (const subQuestion of question.subQuestions) {
                await this.answerQuestion(subQuestion);
                await this.delay(500); // 子题之间延迟
            }
        },

        clickElement(element) {
            // 模拟真实点击
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            setTimeout(() => {
                element.click();
                element.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                }));
            }, 200);
        },

        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    };

    // UI 管理器
    const UIManager = {
        init() {
            this.addStyles();
            this.createMainPanel();
            this.bindEvents();
            // 检查授权状态
            AuthManager.checkAuthorization();
            Logger.info('夏尼猫免费刷题助手已启动');
        },

        addStyles() {
            GM_addStyle(`
                .shanmao-panel {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    width: 350px;
                    max-height: 80vh;
                    background: ${CONFIG.COLORS.CARD};
                    border: 2px solid ${CONFIG.COLORS.PRIMARY};
                    border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                    z-index: 10000;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    overflow: hidden;
                    backdrop-filter: blur(10px);
                    transition: all 0.3s ease;
                }

                .shanmao-panel.minimized {
                    height: 60px;
                    overflow: hidden;
                }

                .shanmao-header {
                    background: linear-gradient(135deg, ${CONFIG.COLORS.PRIMARY}, #357ABD);
                    color: white;
                    padding: 15px;
                    font-weight: bold;
                    font-size: 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: move;
                }

                .shanmao-minimize-btn {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 18px;
                    cursor: pointer;
                    padding: 0;
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background-color 0.2s;
                }

                .shanmao-minimize-btn:hover {
                    background-color: rgba(255,255,255,0.2);
                }

                .shanmao-content {
                    padding: 20px;
                    max-height: calc(80vh - 60px);
                    overflow-y: auto;
                }

                .shanmao-section {
                    margin-bottom: 20px;
                    padding: 15px;
                    background: ${CONFIG.COLORS.BACKGROUND};
                    border-radius: 8px;
                    border: 1px solid ${CONFIG.COLORS.BORDER};
                }

                .shanmao-section h3 {
                    margin: 0 0 15px 0;
                    color: ${CONFIG.COLORS.TEXT};
                    font-size: 14px;
                    font-weight: 600;
                }

                .shanmao-input {
                    width: 100%;
                    padding: 10px;
                    border: 2px solid ${CONFIG.COLORS.BORDER};
                    border-radius: 6px;
                    font-size: 14px;
                    transition: border-color 0.2s;
                    box-sizing: border-box;
                }

                .shanmao-input:focus {
                    outline: none;
                    border-color: ${CONFIG.COLORS.PRIMARY};
                }

                .shanmao-select {
                    width: 100%;
                    padding: 10px;
                    border: 2px solid ${CONFIG.COLORS.BORDER};
                    border-radius: 6px;
                    font-size: 14px;
                    background: white;
                    cursor: pointer;
                }

                .shanmao-btn {
                    width: 100%;
                    padding: 12px;
                    border: none;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    margin-bottom: 10px;
                }

                .shanmao-btn-primary {
                    background: ${CONFIG.COLORS.PRIMARY};
                    color: white;
                }

                .shanmao-btn-primary:hover {
                    background: #357ABD;
                    transform: translateY(-1px);
                }

                .shanmao-btn-success {
                    background: ${CONFIG.COLORS.SUCCESS};
                    color: white;
                }

                .shanmao-btn-success:hover {
                    background: #6BB91C;
                    transform: translateY(-1px);
                }

                .shanmao-btn-warning {
                    background: ${CONFIG.COLORS.WARNING};
                    color: white;
                }

                .shanmao-btn-warning:hover {
                    background: #E09900;
                    transform: translateY(-1px);
                }

                .shanmao-btn-danger {
                    background: ${CONFIG.COLORS.ERROR};
                    color: white;
                }

                .shanmao-btn-danger:hover {
                    background: #B8001A;
                    transform: translateY(-1px);
                }

                .shanmao-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                    transform: none !important;
                }

                .shanmao-status {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 10px;
                    background: linear-gradient(135deg, #f8f9fa, #e9ecef);
                    border-radius: 6px;
                    margin-bottom: 15px;
                    font-size: 13px;
                    font-weight: 500;
                }

                .shanmao-progress {
                    width: 100%;
                    height: 8px;
                    background: ${CONFIG.COLORS.BORDER};
                    border-radius: 4px;
                    overflow: hidden;
                    margin: 10px 0;
                }

                .shanmao-progress-bar {
                    height: 100%;
                    background: linear-gradient(90deg, ${CONFIG.COLORS.PRIMARY}, ${CONFIG.COLORS.SUCCESS});
                    transition: width 0.3s ease;
                    border-radius: 4px;
                }

                .shanmao-log-container {
                    max-height: 200px;
                    overflow-y: auto;
                    border: 1px solid ${CONFIG.COLORS.BORDER};
                    border-radius: 6px;
                    background: white;
                }

                .shanmao-log-item {
                    padding: 8px 12px;
                    border-bottom: 1px solid #f0f0f0;
                    font-size: 12px;
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                }

                .shanmao-log-item:last-child {
                    border-bottom: none;
                }

                .shanmao-log-time {
                    color: #666;
                    font-size: 11px;
                    white-space: nowrap;
                    min-width: 60px;
                }

                .shanmao-log-message {
                    flex: 1;
                    word-break: break-word;
                }

                .shanmao-log-info {
                    border-left: 3px solid ${CONFIG.COLORS.PRIMARY};
                }

                .shanmao-log-success {
                    border-left: 3px solid ${CONFIG.COLORS.SUCCESS};
                }

                .shanmao-log-warning {
                    border-left: 3px solid ${CONFIG.COLORS.WARNING};
                }

                .shanmao-log-error {
                    border-left: 3px solid ${CONFIG.COLORS.ERROR};
                }

                .shanmao-stats {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                    margin-bottom: 15px;
                }

                .shanmao-stat-item {
                    text-align: center;
                    padding: 10px;
                    background: white;
                    border-radius: 6px;
                    border: 1px solid ${CONFIG.COLORS.BORDER};
                }

                .shanmao-stat-value {
                    font-size: 18px;
                    font-weight: bold;
                    color: ${CONFIG.COLORS.PRIMARY};
                }

                .shanmao-stat-label {
                    font-size: 12px;
                    color: #666;
                    margin-top: 2px;
                }

                @media (max-width: 768px) {
                    .shanmao-panel {
                        width: 300px;
                        right: 10px;
                        top: 10px;
                    }
                }

                /* 滚动条样式 */
                .shanmao-content::-webkit-scrollbar,
                .shanmao-log-container::-webkit-scrollbar {
                    width: 6px;
                }

                .shanmao-content::-webkit-scrollbar-track,
                .shanmao-log-container::-webkit-scrollbar-track {
                    background: #f1f1f1;
                    border-radius: 3px;
                }

                .shanmao-content::-webkit-scrollbar-thumb,
                .shanmao-log-container::-webkit-scrollbar-thumb {
                    background: ${CONFIG.COLORS.PRIMARY};
                    border-radius: 3px;
                }

                .shanmao-content::-webkit-scrollbar-thumb:hover,
                .shanmao-log-container::-webkit-scrollbar-thumb:hover {
                    background: #357ABD;
                }
            `);
        },

        createMainPanel() {
            const panel = document.createElement('div');
            panel.className = 'shanmao-panel';
            panel.id = 'shanmao-main-panel';
            
            panel.innerHTML = `
                <div class="shanmao-header">
                    <span>🐱 夏尼猫免费刷题助手</span>
                    <button class="shanmao-minimize-btn" id="shanmao-minimize">−</button>
                </div>
                <div class="shanmao-content">
                    <!-- 授权验证区域 -->
                    <div class="shanmao-section">
                        <h3>🔐 授权验证</h3>
                        <div style="margin-bottom: 10px;">
                            <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #666;">授权码:</label>
                            <input type="password" 
                                   class="shanmao-input" 
                                   id="shanmao-auth-code" 
                                   placeholder="请输入授权码"
                                   value="${state.authCode || ''}">
                            <div style="margin-top: 5px; font-size: 11px; color: #888; line-height: 1.4;">
                                💡 <strong>获取授权码:</strong><br>
                                关注微信公众号 <strong style="color: #4A90E2;">"夏尼猫"</strong> 回复 <strong style="color: #4A90E2;">"授权码"</strong> 获取
                            </div>
                        </div>
                        <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                            <button class="shanmao-btn shanmao-btn-primary" id="shanmao-verify-auth" style="flex: 1;">
                                🔓 验证授权
                            </button>
                            <button class="shanmao-btn shanmao-btn-info" id="shanmao-show-qrcode" style="flex: 1;">
                                📱 获取授权码
                            </button>
                        </div>
                        <div id="shanmao-auth-status" style="padding: 10px; border-radius: 5px; margin-bottom: 15px; text-align: center; font-size: 12px; display: none;">
                            <!-- 授权状态显示 -->
                        </div>
                    </div>

                    <!-- API 配置区域 -->
                    <div class="shanmao-section" id="shanmao-api-section" style="display: none;">
                        <h3>🔑 API 配置</h3>
                        <div style="margin-bottom: 10px;">
                            <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #666;">API URL:</label>
                            <input type="text" 
                                   class="shanmao-input" 
                                   id="shanmao-api-url" 
                                   placeholder="API URL (默认: https://api.deepseek.com/v1/chat/completions)"
                                   value="${state.apiUrl}">
                        </div>
                        <div style="margin-bottom: 10px;">
                            <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #666;">API Key:</label>
                            <input type="password" 
                                   class="shanmao-input" 
                                   id="shanmao-api-key" 
                                   placeholder="请输入 API Key"
                                   value="${state.apiKey}">
                            <div style="margin-top: 5px; font-size: 11px; color: #888; line-height: 1.4;">
                                💡 <strong>获取API Key:</strong><br>
                                1. 访问 <a href="https://platform.deepseek.com" target="_blank" style="color: #4A90E2;">platform.deepseek.com</a><br>
                                2. 注册/登录账号<br>
                                3. 进入"API Keys"页面<br>
                                4. 创建新的API Key
                            </div>
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #666;">AI 模型:</label>
                            <select class="shanmao-select" id="shanmao-model-select">
                                <option value="${CONFIG.MODELS.CHAT}" ${state.selectedModel === CONFIG.MODELS.CHAT ? 'selected' : ''}>DeepSeek Chat (快速)</option>
                                <option value="${CONFIG.MODELS.REASONER}" ${state.selectedModel === CONFIG.MODELS.REASONER ? 'selected' : ''}>DeepSeek Reasoner (推理)</option>
                            </select>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button class="shanmao-btn shanmao-btn-primary" id="shanmao-save-config" style="flex: 1;">
                                💾 保存配置
                            </button>
                            <button class="shanmao-btn shanmao-btn-success" id="shanmao-test-api" style="flex: 1;">
                                🔗 测试连接
                            </button>
                        </div>
                    </div>

                    <!-- 状态显示区域 -->
                    <div class="shanmao-section">
                        <h3>📊 答题状态</h3>
                        <div class="shanmao-status">
                            <span>状态: <span id="shanmao-status-text">待机中</span></span>
                            <span>模式: <span id="shanmao-current-model">${state.selectedModel}</span></span>
                        </div>
                        <div class="shanmao-stats">
                            <div class="shanmao-stat-item">
                                <div class="shanmao-stat-value" id="shanmao-current-question">0</div>
                                <div class="shanmao-stat-label">当前题目</div>
                            </div>
                            <div class="shanmao-stat-item">
                                <div class="shanmao-stat-value" id="shanmao-total-questions">0</div>
                                <div class="shanmao-stat-label">总题数</div>
                            </div>
                        </div>
                        <div class="shanmao-progress">
                            <div class="shanmao-progress-bar" id="shanmao-progress-bar" style="width: 0%"></div>
                        </div>
                    </div>

                    <!-- 控制按钮区域 -->
                    <div class="shanmao-section">
                        <h3>🎮 操作控制</h3>
                        <button class="shanmao-btn shanmao-btn-primary" id="shanmao-scan-questions">
                            🔍 扫描题目
                        </button>
                        <button class="shanmao-btn shanmao-btn-success" id="shanmao-start-auto" disabled>
                            🚀 开始自动答题
                        </button>
                        <button class="shanmao-btn shanmao-btn-warning" id="shanmao-pause-auto" disabled>
                            ⏸️ 暂停答题
                        </button>
                        <button class="shanmao-btn shanmao-btn-danger" id="shanmao-stop-auto" disabled>
                            ⏹️ 停止答题
                        </button>
                    </div>

                    <!-- 日志区域 -->
                    <div class="shanmao-section">
                        <h3>📝 操作日志</h3>
                        <div class="shanmao-log-container" id="shanmao-log-container">
                            <!-- 日志内容将动态插入 -->
                        </div>
                        <button class="shanmao-btn shanmao-btn-warning" id="shanmao-clear-logs" style="margin-top: 10px;">
                            🗑️ 清空日志
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(panel);
            this.makeDraggable(panel);
        },

        bindEvents() {
            // 授权验证按钮
            document.getElementById('shanmao-verify-auth').addEventListener('click', () => {
                const authCode = document.getElementById('shanmao-auth-code').value.trim();
                if (!authCode) {
                    Logger.error('请输入授权码');
                    return;
                }
                AuthManager.verifyAuthCode(authCode);
            });

            // 获取授权码按钮
            document.getElementById('shanmao-show-qrcode').addEventListener('click', () => {
                AuthManager.showQRCodeGuide();
            });

            // 最小化按钮
            document.getElementById('shanmao-minimize').addEventListener('click', () => {
                const panel = document.getElementById('shanmao-main-panel');
                panel.classList.toggle('minimized');
                const btn = document.getElementById('shanmao-minimize');
                btn.textContent = panel.classList.contains('minimized') ? '+' : '−';
            });

            // 保存配置按钮
            document.getElementById('shanmao-save-config').addEventListener('click', () => {
                const apiUrl = document.getElementById('shanmao-api-url').value.trim();
                const apiKey = document.getElementById('shanmao-api-key').value.trim();
                const selectedModel = document.getElementById('shanmao-model-select').value;
                
                // 验证输入
                if (!apiUrl) {
                    Logger.error('请输入API URL');
                    return;
                }
                if (!apiKey) {
                    Logger.error('请输入API Key');
                    return;
                }
                
                // 验证API URL格式
                try {
                    new URL(apiUrl);
                } catch (e) {
                    Logger.error('API URL格式不正确，请检查URL格式');
                    return;
                }
                
                // 验证API Key
                if (apiKey.length < 10) {
                    Logger.error('API Key长度不正确，请检查是否完整');
                    return;
                }
                
                // 保存配置
                state.apiUrl = apiUrl;
                state.apiKey = apiKey;
                state.selectedModel = selectedModel;
                
                GM_setValue('deepseek_api_url', state.apiUrl);
                GM_setValue('deepseek_api_key', state.apiKey);
                GM_setValue('selected_model', state.selectedModel);
                
                document.getElementById('shanmao-current-model').textContent = state.selectedModel;
                Logger.success('配置已保存成功！');
            });

            // 测试API连接按钮
            document.getElementById('shanmao-test-api').addEventListener('click', async () => {
                const apiUrl = document.getElementById('shanmao-api-url').value.trim();
                const apiKey = document.getElementById('shanmao-api-key').value.trim();
                const selectedModel = document.getElementById('shanmao-model-select').value;
                
                if (!apiUrl || !apiKey) {
                    Logger.error('请先填写API URL和API Key');
                    return;
                }
                
                // 验证API URL格式
                try {
                    new URL(apiUrl);
                } catch (e) {
                    Logger.error('API URL格式不正确，请检查URL格式');
                    return;
                }
                
                // 验证API Key格式
                if (apiKey.length < 10) {
                    Logger.error('API Key长度不正确，请检查是否完整');
                    return;
                }
                
                Logger.info(`正在测试API连接... (模型: ${selectedModel})`);
                
                try {
                    // 临时更新状态进行测试
                    const originalUrl = state.apiUrl;
                    const originalKey = state.apiKey;
                    const originalModel = state.selectedModel;
                    
                    state.apiUrl = apiUrl;
                    state.apiKey = apiKey;
                    state.selectedModel = selectedModel;
                    
                    // 发送测试请求
                    const testQuestion = {
                        question: '请回答"测试成功"',
                        type: 'single',
                        options: [
                            { label: 'A', text: '测试成功' },
                            { label: 'B', text: '测试失败' }
                        ]
                    };
                    
                    const startTime = Date.now();
                    const response = await DeepSeekAPI.getAnswer(testQuestion, selectedModel);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;
                    
                    Logger.success(`API连接测试成功！响应时间: ${responseTime}ms`);
                    Logger.info(`API响应: ${response.substring(0, 50)}${response.length > 50 ? '...' : ''}`);
                    
                    // 恢复原始状态
                    state.apiUrl = originalUrl;
                    state.apiKey = originalKey;
                    state.selectedModel = originalModel;
                } catch (error) {
                    Logger.error(`API连接测试失败: ${error.message}`);
                    
                    // 提供故障排除建议
                    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                        Logger.warning('建议检查: API Key是否正确');
                    } else if (error.message.includes('404') || error.message.includes('Not Found')) {
                        Logger.warning('建议检查: API URL是否正确');
                    } else if (error.message.includes('网络') || error.message.includes('timeout')) {
                        Logger.warning('建议检查: 网络连接是否正常');
                    } else if (error.message.includes('quota') || error.message.includes('limit')) {
                        Logger.warning('建议检查: API配额是否充足');
                    }
                    
                    // 恢复原始状态
                    state.apiUrl = GM_getValue('deepseek_api_url', CONFIG.DEFAULT_API_URL);
                    state.apiKey = GM_getValue('deepseek_api_key', '');
                    state.selectedModel = GM_getValue('selected_model', CONFIG.MODELS.CHAT);
                }
            });

            // 模型选择
            document.getElementById('shanmao-model-select').addEventListener('change', (e) => {
                state.selectedModel = e.target.value;
                document.getElementById('shanmao-current-model').textContent = state.selectedModel;
                Logger.info(`已切换到 ${state.selectedModel} 模型`);
            });

            // 扫描题目
            document.getElementById('shanmao-scan-questions').addEventListener('click', () => {
                if (!state.isAuthorized || state.authCode !== AuthManager.VALID_AUTH_CODE) {
                    Logger.error('请先完成授权验证，关注公众号"夏尼猫"获取授权码');
                    return;
                }
                this.scanQuestions();
            });

            // 开始自动答题
            document.getElementById('shanmao-start-auto').addEventListener('click', () => {
                if (!state.isAuthorized || state.authCode !== AuthManager.VALID_AUTH_CODE) {
                    Logger.error('请先完成授权验证，关注公众号"夏尼猫"获取授权码');
                    return;
                }
                this.startAutoAnswering();
            });

            // 暂停答题
            document.getElementById('shanmao-pause-auto').addEventListener('click', () => {
                this.pauseAutoAnswering();
            });

            // 停止答题
            document.getElementById('shanmao-stop-auto').addEventListener('click', () => {
                this.stopAutoAnswering();
            });

            // 清空日志
            document.getElementById('shanmao-clear-logs').addEventListener('click', () => {
                state.logs = [];
                Logger.updateLogDisplay();
                Logger.info('日志已清空');
            });
        },

        makeDraggable(element) {
            // 检查是否已经设置过拖拽功能
            if (element.dataset.draggable === 'true') {
                return;
            }
            element.dataset.draggable = 'true';

            let isDragging = false;
            let currentX;
            let currentY;
            let initialX;
            let initialY;
            let xOffset = 0;
            let yOffset = 0;

            const header = element.querySelector('.shanmao-header');

            header.addEventListener('mousedown', dragStart);
            document.addEventListener('mousemove', drag);
            document.addEventListener('mouseup', dragEnd);

            function dragStart(e) {
                if (e.target.classList.contains('shanmao-minimize-btn')) return;
                
                initialX = e.clientX - xOffset;
                initialY = e.clientY - yOffset;

                if (e.target === header || header.contains(e.target)) {
                    isDragging = true;
                }
            }

            function drag(e) {
                if (isDragging) {
                    e.preventDefault();
                    currentX = e.clientX - initialX;
                    currentY = e.clientY - initialY;

                    xOffset = currentX;
                    yOffset = currentY;

                    element.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
                }
            }

            function dragEnd() {
                initialX = currentX;
                initialY = currentY;
                isDragging = false;
            }
        },

        updateStatus(status) {
            document.getElementById('shanmao-status-text').textContent = status;
        },

        updateProgress() {
            const progress = state.totalQuestions > 0 ? (state.currentQuestion / state.totalQuestions) * 100 : 0;
            document.getElementById('shanmao-progress-bar').style.width = `${progress}%`;
            document.getElementById('shanmao-current-question').textContent = state.currentQuestion;
            document.getElementById('shanmao-total-questions').textContent = state.totalQuestions;
        },

        scanQuestions() {
            Logger.info('开始扫描页面题目...');
            state.questions = QuestionExtractor.extractQuestions();
            state.totalQuestions = state.questions.length;
            state.currentQuestion = 0;
            
            this.updateProgress();
            
            if (state.totalQuestions > 0) {
                document.getElementById('shanmao-start-auto').disabled = false;
                Logger.success(`扫描完成，发现 ${state.totalQuestions} 道题目`);
            } else {
                Logger.warning('未发现任何题目，请确认页面已加载完成');
            }
        },

        async startAutoAnswering() {
            if (!state.apiKey) {
                Logger.error('请先设置 DeepSeek API Key');
                return;
            }

            if (state.questions.length === 0) {
                Logger.error('请先扫描题目');
                return;
            }

            state.isRunning = true;
            this.updateStatus('答题中...');
            
            // 更新按钮状态
            document.getElementById('shanmao-start-auto').disabled = true;
            document.getElementById('shanmao-pause-auto').disabled = false;
            document.getElementById('shanmao-stop-auto').disabled = false;
            document.getElementById('shanmao-scan-questions').disabled = true;

            Logger.info('开始自动答题');

            for (let i = state.currentQuestion; i < state.questions.length && state.isRunning; i++) {
                state.currentQuestion = i + 1;
                this.updateProgress();
                
                await AutoAnswerer.answerQuestion(state.questions[i]);
                
                // 题目间延迟
                if (state.isRunning && i < state.questions.length - 1) {
                    await AutoAnswerer.delay(2000);
                }
            }

            if (state.isRunning) {
                this.stopAutoAnswering();
                Logger.success(`答题完成！共完成 ${state.currentQuestion} 道题目`);
            }
        },

        pauseAutoAnswering() {
            state.isRunning = false;
            this.updateStatus('已暂停');
            
            document.getElementById('shanmao-start-auto').disabled = false;
            document.getElementById('shanmao-pause-auto').disabled = true;
            
            Logger.warning('答题已暂停');
        },

        stopAutoAnswering() {
            state.isRunning = false;
            state.currentQuestion = 0;
            this.updateStatus('待机中');
            this.updateProgress();
            
            // 重置按钮状态
            document.getElementById('shanmao-start-auto').disabled = false;
            document.getElementById('shanmao-pause-auto').disabled = true;
            document.getElementById('shanmao-stop-auto').disabled = true;
            document.getElementById('shanmao-scan-questions').disabled = false;
            
            Logger.info('答题已停止');
        }
    };

    // 初始化
    function init() {
        // 等待页面加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(UIManager.init.bind(UIManager), 1000);
            });
        } else {
            setTimeout(UIManager.init.bind(UIManager), 1000);
        }
    }

    // 启动脚本
    init();

})();