// YouTube動画を管理する配列
let videos = [];
let channels = []; // チャンネル情報を管理
let currentLayout = 'grid';
let gridColumns = 2;
let apiKey = '';
let updateInterval = null;
let updateIntervalMinutes = 5; // 更新間隔（分）
let autoplayEnabled = true;
let autoMuteEnabled = true;
let showStatusBadge = true;
let autoRemoveEnded = true; // 終了した配信を自動削除
let showOnlyRegisteredChannels = true; // 登録チャンネル由来のみ表示
let players = {}; // YouTube Player オブジェクトを管理
let videoChannelMap = {}; // videoId -> channelId のキャッシュ

const SCROLL_POSITION_KEY = 'scrollPosition'; // localStorage key for scroll position
let pendingScrollPosition = null; // scroll position to restore after reload
const SETTINGS_SECTION_STATE_KEY = 'settingsSectionState'; // 設定モーダルの折り畳み状態
let sectionCollapseState = {};
const CONTROLS_PANEL_STATE_KEY = 'controlsPanelCollapsed';

function normalizeKeywordFilter(filterText) {
    if (!filterText) return [];
    return filterText
        .split(/[,、\s]+/)
        .map(keyword => keyword.trim().toLowerCase())
        .filter(Boolean);
}

function titleMatchesKeywords(title, keywordList) {
    if (!keywordList || keywordList.length === 0) {
        return true;
    }
    const normalizedTitle = (title || '').toLowerCase();
    return keywordList.some(keyword => normalizedTitle.includes(keyword));
}

function findMatchingVideoByKeyword(items, keywordList) {
    if (!items || items.length === 0) {
        return null;
    }
    for (const item of items) {
        const snippetTitle = (item && item.snippet && item.snippet.title) ? item.snippet.title : '';
        if (titleMatchesKeywords(snippetTitle, keywordList)) {
            return item;
        }
    }
    return null;
}

function findMatchingVideoForChannel(items, channelId, keywordList) {
    if (!items || items.length === 0) {
        return null;
    }
    for (const item of items) {
        const snippet = item && item.snippet ? item.snippet : null;
        const snippetChannelId = snippet ? snippet.channelId : null;
        const snippetTitle = snippet ? snippet.title : '';
        if (snippetChannelId && snippetChannelId !== channelId) {
            continue;
        }
        if (titleMatchesKeywords(snippetTitle, keywordList)) {
            return item;
        }
    }
    return null;
}

function escapeHtml(value) {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// YouTube IFrame APIを読み込む
const tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// YouTube IFrame API の準備完了コールバック
let onYouTubeIframeAPIReady = function() {
    console.log('YouTube IFrame API が読み込まれました');
};

// YouTube動画IDを抽出する関数
function extractVideoId(input) {
    // すでにIDの場合
    if (input.length === 11 && !input.includes('/') && !input.includes('.')) {
        return input;
    }
    
    // 通常のYouTube URL
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = input.match(regExp);
    
    if (match && match[7].length === 11) {
        return match[7];
    }
    
    // ライブURL
    const liveRegExp = /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/;
    const liveMatch = input.match(liveRegExp);
    
    if (liveMatch && liveMatch[1]) {
        return liveMatch[1];
    }
    
    return null;
}

// 設定モーダルを開く
function openSettings() {
    const modal = document.getElementById('settingsModal');
    
    // 現在の設定値を入力フィールドに反映
    document.getElementById('settingsApiKey').value = apiKey || '';
    document.getElementById('updateInterval').value = updateIntervalMinutes;
    document.getElementById('autoplayEnabled').checked = autoplayEnabled;
    document.getElementById('autoMuteEnabled').checked = autoMuteEnabled;
    document.getElementById('showStatusBadge').checked = showStatusBadge;
    document.getElementById('showOnlyRegisteredChannels').checked = showOnlyRegisteredChannels;
    document.getElementById('autoRemoveEnded').checked = autoRemoveEnded;
    
    // チャンネルリストも表示
    renderChannelList();
    
    modal.classList.add('show');
}

// 設定モーダルを閉じる
function closeSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('show');
}

// 設定を保存
function saveSettings() {
    // 設定値を取得
    const newApiKey = document.getElementById('settingsApiKey').value.trim();
    const newUpdateInterval = parseInt(document.getElementById('updateInterval').value);
    const newAutoplay = document.getElementById('autoplayEnabled').checked;
    const newAutoMute = document.getElementById('autoMuteEnabled').checked;
    const newShowStatus = document.getElementById('showStatusBadge').checked;
    const newShowOnlyRegisteredChannels = document.getElementById('showOnlyRegisteredChannels').checked;
    const newAutoRemoveEnded = document.getElementById('autoRemoveEnded').checked;
    
    // APIキーが変更された場合
    if (newApiKey !== apiKey) {
        apiKey = newApiKey;
        localStorage.setItem('youtubeApiKey', apiKey);
        
        // 既存のチャンネルを更新
        if (channels.length > 0 && apiKey) {
            updateAllChannels();
        }
    }
    
    // 更新間隔が変更された場合
    if (newUpdateInterval !== updateIntervalMinutes) {
        updateIntervalMinutes = newUpdateInterval;
        localStorage.setItem('updateIntervalMinutes', updateIntervalMinutes);
        
        // 自動更新を再起動
        if (channels.length > 0 && apiKey) {
            startAutoUpdate();
        }
    }
    
    // その他の設定を保存
    autoplayEnabled = newAutoplay;
    autoMuteEnabled = newAutoMute;
    showStatusBadge = newShowStatus;
    showOnlyRegisteredChannels = newShowOnlyRegisteredChannels;
    autoRemoveEnded = newAutoRemoveEnded;
    
    localStorage.setItem('autoplayEnabled', autoplayEnabled);
    localStorage.setItem('autoMuteEnabled', autoMuteEnabled);
    localStorage.setItem('showStatusBadge', showStatusBadge);
    localStorage.setItem('showOnlyRegisteredChannels', showOnlyRegisteredChannels);
    localStorage.setItem('autoRemoveEnded', autoRemoveEnded);
    
    // モーダルを閉じる
    closeSettings();
    
    // 設定変更を反映するため再描画
    renderVideos();
    
    // 保存して重複を確実に削除
    saveToLocalStorage();
    
    alert('設定を保存しました');
}

// APIキーを保存（旧関数 - 互換性のため残す）
function saveApiKey() {
    const input = document.getElementById('apiKeyInput');
    const status = document.getElementById('apiKeyStatus');
    
    if (!input.value.trim()) {
        status.textContent = '⚠️ APIキーを入力してください';
        status.className = 'status-text error';
        return;
    }
    
    apiKey = input.value.trim();
    localStorage.setItem('youtubeApiKey', apiKey);
    status.textContent = '✓ APIキー保存完了';
    status.className = 'status-text success';
    
    // 既存のチャンネルを更新
    if (channels.length > 0) {
        updateAllChannels();
    }
}

// チャンネルを追加
async function addChannel() {
    const input = document.getElementById('channelInput');
    const channelId = input.value.trim();
    const keywordInput = document.getElementById('channelKeywordInput');
    const keywordFilter = keywordInput ? keywordInput.value.trim() : '';
    
    if (!apiKey) {
        alert('先にYouTube Data APIキーを保存してください');
        return;
    }
    
    if (!channelId) {
        alert('Channel IDを入力してください');
        return;
    }
    
    // 重複チェック
    if (channels.some(ch => ch.channelId === channelId)) {
        alert('このチャンネルは既に追加されています');
        return;
    }
    
    // チャンネルのライブ配信を検索
    const liveInfo = await fetchChannelLiveStream(channelId, keywordFilter);
    
    // チャンネル名を取得
    const channelName = await fetchChannelName(channelId);
    
    if (liveInfo && liveInfo.videoId) {
        // 既に同じ動画が追加されているかチェック
        if (videos.includes(liveInfo.videoId)) {
            alert('このライブ配信は既に追加されています');
            input.value = '';
            return;
        }
        
        channels.push({
            channelId: channelId,
            name: channelName,
            videoId: liveInfo.videoId,
            status: liveInfo.status,
            keywordFilter: keywordFilter
        });

        videos.push(liveInfo.videoId);
        videoChannelMap[liveInfo.videoId] = channelId;
    } else {
        // ライブ配信がない場合でもチャンネルを登録
        channels.push({
            channelId: channelId,
            name: channelName,
            videoId: null,
            status: 'none',
            keywordFilter: keywordFilter
        });
        alert('現在このチャンネルでライブ配信は行われていません。定期的にチェックします。');
    }
    
    input.value = '';
    if (keywordInput) {
        keywordInput.value = '';
    }
    
    // 重複チェック
    removeDuplicateVideos();
    
    renderVideos();
    
    // 自動更新を開始
    startAutoUpdate();
}

// チャンネルのライブ配信を取得
async function fetchChannelLiveStream(channelId, keywordFilter = '') {
    try {
        const keywords = normalizeKeywordFilter(keywordFilter);
        // まず、チャンネルの配信中のライブを検索
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&maxResults=10&key=${apiKey}`;
        
        const response = await fetch(searchUrl);
        const data = await response.json();
        
        if (data.error) {
            console.error('API Error:', data.error);
            alert(`APIエラー: ${data.error.message}`);
            return null;
        }
        
        const liveMatch = findMatchingVideoForChannel(data.items, channelId, keywords);
        if (liveMatch) {
            return { videoId: liveMatch.id.videoId, status: 'live' };
        }
        
        // ライブ配信がない場合、予定されているライブを検索
        const upcomingUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=upcoming&type=video&order=date&maxResults=10&key=${apiKey}`;
        
        const upcomingResponse = await fetch(upcomingUrl);
        const upcomingData = await upcomingResponse.json();
        
        const upcomingMatch = findMatchingVideoForChannel(upcomingData.items, channelId, keywords);
        if (upcomingMatch) {
            return { videoId: upcomingMatch.id.videoId, status: 'upcoming' };
        }
        
        return null;
    } catch (error) {
        console.error('Error fetching channel live stream:', error);
        alert('ライブ配信の取得に失敗しました');
        return null;
    }
}

// チャンネル名を取得
async function fetchChannelName(channelId) {
    try {
        const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${apiKey}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            return data.items[0].snippet.title;
        }
        
        return 'チャンネル';
    } catch (error) {
        console.error('Error fetching channel name:', error);
        return 'チャンネル';
    }
}

// 動画のステータスを取得
async function getVideoStatus(videoId) {
    try {
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${videoId}&key=${apiKey}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            const video = data.items[0];
            const snippet = video.snippet;
            const liveDetails = video.liveStreamingDetails;
            
            console.log(`ステータス取得: ${videoId} - liveBroadcastContent: ${snippet.liveBroadcastContent}`);
            
            if (snippet.liveBroadcastContent === 'live') {
                return { status: 'live', title: snippet.title };
            } else if (snippet.liveBroadcastContent === 'upcoming') {
                return { status: 'upcoming', title: snippet.title };
            } else if (snippet.liveBroadcastContent === 'none') {
                // 'none'の場合、actualEndTimeがある場合のみ終了と判定
                if (liveDetails && liveDetails.actualEndTime) {
                    return { status: 'ended', title: snippet.title };
                } else {
                    // 終了時刻が記録されていない場合は不明として扱う（削除しない）
                    console.warn(`動画 ${videoId} は liveBroadcastContent='none' だが actualEndTime がありません`);
                    return { status: 'unknown', title: snippet.title };
                }
            } else {
                return { status: 'ended', title: snippet.title };
            }
        }
        
        // 動画が見つからない場合（削除された等）
        console.warn(`動画 ${videoId} が見つかりませんでした`);
        return { status: 'unknown', title: '' };
    } catch (error) {
        console.error('Error getting video status:', error);
        // エラー時は不明として扱う（削除しない）
        return { status: 'unknown', title: '' };
    }
}

async function fetchVideoChannelIds(videoIds) {
    if (!apiKey || !videoIds || videoIds.length === 0) {
        return;
    }

    const batchSize = 50;
    for (let i = 0; i < videoIds.length; i += batchSize) {
        const batch = videoIds.slice(i, i + batchSize);
        try {
            const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${batch.join(',')}&key=${apiKey}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                console.error('API Error (video channel lookup):', data.error);
                continue;
            }

            const foundIds = new Set();
            if (data.items && data.items.length > 0) {
                data.items.forEach(item => {
                    const channelId = item && item.snippet ? item.snippet.channelId : null;
                    videoChannelMap[item.id] = channelId || null;
                    foundIds.add(item.id);
                });
            }

            batch.forEach(videoId => {
                if (!foundIds.has(videoId) && !Object.prototype.hasOwnProperty.call(videoChannelMap, videoId)) {
                    videoChannelMap[videoId] = null;
                }
            });
        } catch (error) {
            console.error('Error fetching video channel ids:', error);
        }
    }
}

// 全チャンネルを更新
async function updateAllChannels(forceRefresh = false) {
    let hasChanges = false;
    
    for (let channel of channels) {
        const liveInfo = await fetchChannelLiveStream(channel.channelId, channel.keywordFilter || '');
        
        if (liveInfo && liveInfo.videoId && liveInfo.videoId !== channel.videoId) {
            // 新しいライブ配信が見つかった
            if (channel.videoId) {
                // 古い動画を削除
                videos = videos.filter(id => id !== channel.videoId);
            }
            
            channel.videoId = liveInfo.videoId;
            channel.status = liveInfo.status;
            
            if (!videos.includes(liveInfo.videoId)) {
                videos.push(liveInfo.videoId);
            }
            videoChannelMap[liveInfo.videoId] = channel.channelId;
            hasChanges = true;
        } else if (liveInfo && liveInfo.videoId === channel.videoId) {
            if (channel.status !== liveInfo.status) {
                channel.status = liveInfo.status;
                hasChanges = true;
            }
        } else if (!liveInfo && channel.videoId) {
            // ライブ配信が終了した可能性があるため、現在の動画を確認
            const currentStatus = apiKey ? await getVideoStatus(channel.videoId) : { status: 'unknown', title: '' };
            if (currentStatus.status === 'ended') {
                if (autoRemoveEnded) {
                    videos = videos.filter(id => id !== channel.videoId);
                    console.log(`ライブ配信が終了したため削除しました: チャンネル ${channel.channelId}`);
                    channel.videoId = null;
                    channel.status = 'none';
                } else {
                    channel.status = 'ended';
                }
                hasChanges = true;
            } else {
                // 検索で見つからなくても配信中の可能性があるため保持
                channel.status = currentStatus.status;
            }
        }
    }
    
    // チャンネルから追加された動画のステータスをチェック（自動削除が有効な場合のみ）
    if (autoRemoveEnded) {
        for (let i = videos.length - 1; i >= 0; i--) {
            const videoId = videos[i];
            const channelInfo = channels.find(ch => ch.videoId === videoId);
            
            if (apiKey && channelInfo) {
                const videoStatus = await getVideoStatus(videoId);
                
                // 明確に終了した配信のみ削除（unknownやerrorは削除しない）
                if (videoStatus.status === 'ended') {
                    console.log(`配信が終了したため削除: ${videoId} - ${videoStatus.title}`);
                    videos.splice(i, 1);
                    
                    // チャンネル情報も更新
                    channelInfo.videoId = null;
                    channelInfo.status = 'none';
                    hasChanges = true;
                } else if (videoStatus.status === 'unknown') {
                    console.warn(`配信 ${videoId} のステータスが不明のため、削除をスキップしました`);
                }
            }
        }
    }
    
    // 重複チェックと削除
    removeDuplicateVideos();
    
    if (hasChanges || forceRefresh) {
        renderVideos();
    }
}

// 重複した動画IDを削除する関数
function removeDuplicateVideos() {
    console.log('重複チェック開始 - videos:', videos.length, 'channels:', channels.length);
    console.log('videos配列:', videos);
    console.log('channels配列:', channels.map(ch => ({id: ch.channelId, name: ch.name, videoId: ch.videoId})));
    
    // まず、videos配列の重複を削除（Setを使用）
    const originalVideosLength = videos.length;
    const uniqueVideos = [...new Set(videos)];
    
    // 重複があった場合のみログ出力
    if (uniqueVideos.length < videos.length) {
        console.log(`videos配列の重複を削除: ${videos.length - uniqueVideos.length}件`);
    }
    
    videos = uniqueVideos;
    
    // チャンネル情報も重複チェック
    // 複数のチャンネルが同じvideoIdを持っている場合、最初の1つだけを残す
    const seenVideoIds = new Set();
    const removedChannelVideoIds = new Set();
    const originalChannelsLength = channels.length;
    
    channels = channels.filter(channel => {
        if (!channel.videoId) return true; // videoIdがnullの場合は保持
        
        if (seenVideoIds.has(channel.videoId)) {
            console.log(`重複したチャンネルを統合: ${channel.channelId} (videoId: ${channel.videoId})`);
            removedChannelVideoIds.add(channel.videoId);
            return false; // 重複なので削除
        }
        
        seenVideoIds.add(channel.videoId);
        return true;
    });
    
    if (channels.length < originalChannelsLength) {
        console.log(`channels配列から重複を削除: ${originalChannelsLength - channels.length}件`);
    }
    
    // 削除されたチャンネルのvideoIdで、他に使用していないものはvideos配列からも削除
    // ただし、seenVideoIdsに含まれているものは残す（他のチャンネルで使用中）
    const videosBeforeCleanup = videos.length;
    videos = videos.filter(videoId => {
        // 現在のチャンネルで使用されているvideoIdは保持
        if (seenVideoIds.has(videoId)) {
            return true;
        }
        // 削除されたチャンネルのvideoIdは削除
        if (removedChannelVideoIds.has(videoId)) {
            console.log(`未使用の動画IDを削除: ${videoId}`);
            return false;
        }
        // それ以外（手動追加された動画など）は保持
        return true;
    });
    
    if (videos.length < videosBeforeCleanup) {
        console.log(`未使用動画ID削除: ${videosBeforeCleanup - videos.length}件`);
    }
    
    // 最終的にvideos配列の重複を再度削除
    const finalVideosLength = videos.length;
    videos = [...new Set(videos)];
    
    if (videos.length < finalVideosLength) {
        console.log(`最終重複削除: ${finalVideosLength - videos.length}件`);
    }
    
    console.log('重複チェック完了 - videos:', videos.length, 'channels:', channels.length);
    console.log('最終videos配列:', videos);
    console.log('最終channels配列:', channels.map(ch => ({id: ch.channelId, name: ch.name, videoId: ch.videoId})));
}

// 自動更新を開始
function startAutoUpdate() {
    // 既存のインターバルをクリア
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    
    // 設定された間隔で更新
    const intervalMs = updateIntervalMinutes * 60000;
    updateInterval = setInterval(() => {
        if (channels.length > 0 && apiKey) {
            console.log('Updating channels...');
            updateAllChannels(true);
        }
    }, intervalMs);
}

// 自動更新を停止
function stopAutoUpdate() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

async function fetchVideoChannelId(videoId) {
    if (!apiKey || !videoId) {
        return null;
    }
    if (Object.prototype.hasOwnProperty.call(videoChannelMap, videoId)) {
        return videoChannelMap[videoId];
    }
    try {
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error('API Error (single video channel lookup):', data.error);
            return null;
        }

        if (data.items && data.items.length > 0) {
            const channelId = data.items[0].snippet.channelId || null;
            videoChannelMap[videoId] = channelId;
            return channelId;
        }

        videoChannelMap[videoId] = null;
        return null;
    } catch (error) {
        console.error('Error fetching video channel id:', error);
        return null;
    }
}

// 動画を追加する関数
async function addVideo() {
    const input = document.getElementById('videoInput');
    const videoId = extractVideoId(input.value.trim());
    
    if (!videoId) {
        alert('有効なYouTube URLまたは動画IDを入力してください');
        return;
    }
    
    if (!apiKey) {
        alert('動画追加時に登録チャンネルの判定を行うため、先にYouTube Data APIキーを設定してください');
        return;
    }

    if (channels.length === 0) {
        alert('登録チャンネルがありません。先にチャンネルを追加してください');
        return;
    }

    const registeredChannelIds = new Set(
        channels.map(channel => channel.channelId).filter(Boolean)
    );
    const videoChannelId = await fetchVideoChannelId(videoId);

    if (!videoChannelId || !registeredChannelIds.has(videoChannelId)) {
        alert('登録済みチャンネルの動画ではないため追加できません');
        return;
    }

    // 重複チェック
    if (videos.includes(videoId)) {
        alert('この動画は既に追加されています');
        return;
    }
    
    videos.push(videoId);
    input.value = '';
    
    // 念のため重複チェック
    removeDuplicateVideos();
    
    renderVideos();
}

// 動画を削除する関数
function removeVideo(videoId) {
    videos = videos.filter(id => id !== videoId);
    
    // チャンネルから削除
    channels = channels.filter(ch => ch.videoId !== videoId);
    
    renderVideos();
}

// 全ての動画をクリア
function clearAll() {
    if (videos.length === 0) return;
    
    if (confirm('全ての動画とチャンネルを削除しますか?')) {
        videos = [];
        channels = [];
        stopAutoUpdate();
        renderVideos();
    }
}

// 動画を表示する関数
async function renderVideos() {
    console.log('renderVideos開始');
    const container = document.getElementById('videoContainer');
    
    // レンダリング前に重複チェックを実行
    removeDuplicateVideos();

    const registeredChannelIds = new Set(
        channels.map(channel => channel.channelId).filter(Boolean)
    );
    const channelVideoIds = new Set(
        channels.map(channel => channel.videoId).filter(Boolean)
    );
    const channelByVideoId = new Map(
        channels.filter(channel => channel.videoId).map(channel => [channel.videoId, channel.channelId])
    );

    if (showOnlyRegisteredChannels && apiKey && videos.length > 0) {
        const unknownIds = videos.filter(
            videoId => !Object.prototype.hasOwnProperty.call(videoChannelMap, videoId)
        );
        if (unknownIds.length > 0) {
            await fetchVideoChannelIds(unknownIds);
        }
    }
    
    // 既存のプレイヤーを全てクリア
    const playerKeys = Object.keys(players);
    console.log('既存プレイヤーをクリア:', playerKeys);
    playerKeys.forEach(videoId => {
        if (players[videoId] && typeof players[videoId].destroy === 'function') {
            try {
                players[videoId].destroy();
                console.log(`プレイヤー破棄完了: ${videoId}`);
            } catch (e) {
                console.error('プレイヤー破棄エラー:', e);
            }
        }
    });
    players = {}; // プレイヤーオブジェクトをリセット
    
    const renderVideoIds = showOnlyRegisteredChannels
        ? (apiKey
            ? videos.filter(videoId => {
                if (!channelVideoIds.has(videoId)) {
                    return false;
                }
                const expectedChannelId = channelByVideoId.get(videoId);
                const mappedChannelId = videoChannelMap[videoId];
                if (mappedChannelId === undefined) {
                    return true;
                }
                return expectedChannelId === mappedChannelId;
            })
            : videos.filter(videoId => channelVideoIds.has(videoId)))
        : videos;

    if (renderVideoIds.length === 0) {
        if (videos.length > 0 && showOnlyRegisteredChannels) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>登録チャンネルの動画がありません</h3>
                    <p>チャンネルを追加するか、この設定をオフにしてください</p>
                </div>
            `;
            console.log('renderVideos完了 - 登録チャンネル動画なし');
            restoreScrollPositionIfNeeded();
            return;
        }
        container.innerHTML = `
            <div class="empty-state">
                <h3>動画がありません</h3>
                <p>YouTube動画のURLまたはChannel IDを入力して追加してください</p>
            </div>
        `;
        console.log('renderVideos完了 - 動画なし');
        restoreScrollPositionIfNeeded();
        return;
    }
    
    console.log(`${renderVideoIds.length}個の動画をレンダリング開始`);
    container.innerHTML = '';
    
    const renderEntries = [];
    
    // 各動画のステータスを取得してライブ/予定だけを抽出
    for (let i = 0; i < renderVideoIds.length; i++) {
        const videoId = renderVideoIds[i];
        console.log(`動画レンダリング準備: ${i + 1}/${renderVideoIds.length} - ${videoId}`);
        const channelInfo = channels.find(ch => ch.videoId === videoId);
        let videoStatus = null;

        if (apiKey) {
            videoStatus = await getVideoStatus(videoId);
            if (!videoStatus || (videoStatus.status !== 'live' && videoStatus.status !== 'upcoming')) {
                continue;
            }
        } else {
            continue;
        }

        renderEntries.push({ videoId, channelInfo, videoStatus });
    }

    const orderedEntries = [
        ...renderEntries.filter(entry => entry.videoStatus.status === 'live'),
        ...renderEntries.filter(entry => entry.videoStatus.status === 'upcoming')
    ];

    if (orderedEntries.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>配信中・配信予定のライブがありません</h3>
                <p>アーカイブは表示されません</p>
            </div>
        `;
        console.log('renderVideos完了 - ライブ/予定なし');
        restoreScrollPositionIfNeeded();
        return;
    }

    // ライブ -> 予定 の順で表示
    for (let i = 0; i < orderedEntries.length; i++) {
        const entry = orderedEntries[i];
        const videoId = entry.videoId;
        const channelInfo = entry.channelInfo;
        const videoStatus = entry.videoStatus;
        console.log(`動画レンダリング: ${i + 1}/${orderedEntries.length} - ${videoId}`);
        const wrapper = document.createElement('div');
        wrapper.className = 'video-wrapper';
        
        // PIPレイアウトの場合、2つ目以降をpip-secondaryクラスに
        if (currentLayout === 'pip' && i > 0) {
            wrapper.className += ' pip-secondary';
        }
        
        let statusHtml = '';
        
        // ステータスバッジを表示する設定の場合のみ表示
        if (showStatusBadge && apiKey && channelInfo && videoStatus) {
            let statusClass = '';
            let statusText = '';
            
            if (videoStatus.status === 'live') {
                statusClass = 'status-live';
                statusText = '?? 配信中';
            } else if (videoStatus.status === 'upcoming') {
                statusClass = 'status-upcoming';
                statusText = '?? 予定';
            }
            
            if (statusText) {
                statusHtml = `
                    <div class="video-status ${statusClass}">
                        <span class="status-indicator"></span>
                        ${statusText}
                    </div>
                `;
            }
        }
        
        // 自動再生とミュート設定を適用
        const autoplay = autoplayEnabled ? 1 : 0;
        const mute = (autoplayEnabled && autoMuteEnabled) ? 1 : 0;
        
        wrapper.innerHTML = `
            <button class="remove-btn" onclick="removeVideo('${videoId}')" title="削除">×</button>
            ${statusHtml}
            <div class="video-aspect">
                <div id="player-${videoId}"></div>
            </div>
        `;
        
        container.appendChild(wrapper);
        
        // YouTube Player を初期化
        if (typeof YT !== 'undefined' && YT.Player) {
            players[videoId] = new YT.Player(`player-${videoId}`, {
                videoId: videoId,
                playerVars: {
                    autoplay: autoplay,
                    mute: mute,
                    playsinline: 1,
                    controls: 1,
                    modestbranding: 1,
                    rel: 0,
                    enablejsapi: 1
                },
                events: {
                    'onReady': function(event) {
                        // プレイヤーの準備が完了
                        if (autoplay) {
                            event.target.playVideo();
                        }
                    }
                }
            });
        } else {
            // IFrame API が読み込まれていない場合は従来の iframe を使用
            const playerDiv = document.getElementById(`player-${videoId}`);
            playerDiv.innerHTML = `
                <iframe
                    src="https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=${autoplay}&mute=${mute}&playsinline=1&controls=1&modestbranding=1&rel=0"
                    frameborder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowfullscreen
                    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
                ></iframe>
            `;
        }
    }

    restoreScrollPositionIfNeeded();
}

// タブがアクティブになった時にライブ配信を最新位置にシーク
function seekToLive() {
    Object.keys(players).forEach(videoId => {
        const player = players[videoId];
        if (player && typeof player.seekTo === 'function') {
            try {
                const duration = player.getDuration();
                if (duration > 0) {
                    // ライブ配信の場合、最新の位置（duration付近）にシーク
                    player.seekTo(duration, true);
                    console.log(`${videoId} を最新位置にシークしました`);
                }
            } catch (e) {
                console.error('シークエラー:', e);
            }
        }
    });
}

// チャンネルリストを表示する関数
function renderChannelList() {
    const channelListContainer = document.getElementById('channelList');
    
    if (channels.length === 0) {
        channelListContainer.innerHTML = `
            <div style="text-align: center; color: #999; padding: 20px;">
                登録されているチャンネルがありません
            </div>
        `;
        return;
    }
    
    channelListContainer.innerHTML = '';
    
    channels.forEach(channel => {
        const channelItem = document.createElement('div');
        channelItem.className = 'channel-item';

        let statusText = '待機中';
        const hasVideoId = !!channel.videoId;
        const hasMapEntry = hasVideoId && Object.prototype.hasOwnProperty.call(videoChannelMap, channel.videoId);
        const mappedChannelId = hasVideoId ? videoChannelMap[channel.videoId] : null;

        if (hasVideoId && apiKey && !hasMapEntry) {
            fetchVideoChannelId(channel.videoId).then(() => renderChannelList());
        }

        if (hasVideoId && apiKey && hasMapEntry && mappedChannelId && mappedChannelId !== channel.channelId) {
            statusText = `チャンネル不一致: ${channel.videoId}`;
        } else if (hasVideoId && channel.status === 'live') {
            statusText = `📺 現在の配信: ${channel.videoId}`;
        } else if (hasVideoId && channel.status === 'upcoming') {
            statusText = `配信予定: ${channel.videoId}`;
        } else if (hasVideoId && channel.status === 'ended') {
            statusText = `終了: ${channel.videoId}`;
        } else if (hasVideoId) {
            statusText = `状態確認中: ${channel.videoId}`;
        }
        const keywordDisplay = channel.keywordFilter ? channel.keywordFilter : '指定なし';
        const keywordValueAttr = escapeHtml(channel.keywordFilter || '');

        channelItem.innerHTML = `
            <button class="channel-remove-btn" onclick="removeChannel('${channel.channelId}')" title="削除">×</button>
            <div class="channel-name">${channel.name || 'チャンネル'}</div>
            <div class="channel-id">ID: ${channel.channelId}</div>
            <div class="channel-status">${statusText}</div>
            <div class="channel-keyword-note">タイトルキーワード: ${escapeHtml(keywordDisplay)}</div>
            <div class="channel-keyword-control">
                <span>カンマ区切りで複数指定できます</span>
                <input type="text" class="channel-keyword-input" value="${keywordValueAttr}" placeholder="例: 歌, ASMR" onchange="updateChannelKeyword('${channel.channelId}', this.value)">
            </div>
        `;

        channelListContainer.appendChild(channelItem);
    });
}

async function updateChannelKeyword(channelId, newKeywordValue) {
    const channel = channels.find(ch => ch.channelId === channelId);
    if (!channel) {
        return;
    }
    channel.keywordFilter = (newKeywordValue || '').trim();

    if (apiKey) {
        try {
            const liveInfo = await fetchChannelLiveStream(channel.channelId, channel.keywordFilter);
            if (liveInfo && liveInfo.videoId && liveInfo.videoId !== channel.videoId) {
                if (channel.videoId) {
                    videos = videos.filter(id => id !== channel.videoId);
                }
                channel.videoId = liveInfo.videoId;
                channel.status = liveInfo.status;
                if (!videos.includes(liveInfo.videoId)) {
                    videos.push(liveInfo.videoId);
                }
                videoChannelMap[liveInfo.videoId] = channel.channelId;
            } else if (liveInfo && liveInfo.videoId === channel.videoId) {
                channel.status = liveInfo.status;
            } else if (!liveInfo && channel.videoId) {
                videos = videos.filter(id => id !== channel.videoId);
                channel.videoId = null;
                channel.status = 'none';
            }
        } catch (error) {
            console.error('キーワード更新時のライブ取得に失敗しました:', error);
        }
    }

    saveToLocalStorage();
    renderVideos();
    renderChannelList();
}

// チャンネルを削除する関数
function removeChannel(channelId) {
    if (confirm('このチャンネルを削除しますか?')) {
        // 削除対象のチャンネル情報を保持してから削除
        const channel = channels.find(ch => ch.channelId === channelId);
        channels = channels.filter(ch => ch.channelId !== channelId);

        // そのチャンネルから追加された動画も削除
        if (channel && channel.videoId) {
            videos = videos.filter(v => v !== channel.videoId);
        }
        
        saveToLocalStorage();
        renderVideos();
        renderChannelList();
    }
}

// レイアウトを変更する関数
function changeLayout() {
    const select = document.getElementById('layoutSelect');
    currentLayout = select.value;
    const container = document.getElementById('videoContainer');
    
    // 全てのレイアウトクラスを削除
    container.className = 'video-container';
    
    // 新しいレイアウトクラスを追加
    container.classList.add(currentLayout);
    
    // グリッドの場合は列数を適用
    if (currentLayout === 'grid') {
        updateGridColumns();
    }
    
    renderVideos();
}

// グリッドの列数を更新する関数
function updateGridColumns() {
    const select = document.getElementById('columnsSelect');
    gridColumns = parseInt(select.value);
    const container = document.getElementById('videoContainer');
    
    if (currentLayout === 'grid') {
        container.style.gridTemplateColumns = `repeat(${gridColumns}, 1fr)`;
    }
}

// Enterキーで追加
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('videoInput');
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addVideo();
        }
    });
    
    // モーダル外クリックで閉じる
    const modal = document.getElementById('settingsModal');
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeSettings();
        }
    });
    
    initializeSettingSections();
    initializeControlsPanel();
    
    // 初期表示はloadFromLocalStorage内のchangeLayout()で実行されるため不要
});

// ローカルストレージに保存（オプション機能）
function saveToLocalStorage() {
    // 保存前に重複を削除
    removeDuplicateVideos();
    
    localStorage.setItem('youtubeVideos', JSON.stringify(videos));
    localStorage.setItem('youtubeChannels', JSON.stringify(channels));
    localStorage.setItem('layout', currentLayout);
    localStorage.setItem('gridColumns', gridColumns);
}


function storeScrollPosition() {
    const currentScroll = window.scrollY ?? document.documentElement.scrollTop ?? document.body.scrollTop ?? 0;
    const normalizedScroll = Math.max(0, Math.round(currentScroll));
    localStorage.setItem(SCROLL_POSITION_KEY, normalizedScroll.toString());
}

function restoreScrollPositionIfNeeded() {
    if (pendingScrollPosition === null) {
        return;
    }
    
    const positionToRestore = pendingScrollPosition;
    pendingScrollPosition = null;
    
    requestAnimationFrame(() => {
        window.scrollTo(0, positionToRestore);
    });
}

function loadSettingSectionStateFromStorage() {
    try {
        const raw = localStorage.getItem(SETTINGS_SECTION_STATE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                sectionCollapseState = parsed;
            } else {
                sectionCollapseState = {};
            }
        } else {
            sectionCollapseState = {};
        }
    } catch (error) {
        console.error('設定セクション状態の読み込みに失敗しました:', error);
        sectionCollapseState = {};
    }
}

function updateSettingSectionState(sectionId, isCollapsed) {
    if (!sectionId) return;
    
    if (isCollapsed) {
        sectionCollapseState[sectionId] = true;
    } else {
        delete sectionCollapseState[sectionId];
    }
    
    try {
        localStorage.setItem(SETTINGS_SECTION_STATE_KEY, JSON.stringify(sectionCollapseState));
    } catch (error) {
        console.error('設定セクション状態の保存に失敗しました:', error);
    }
}

function toggleSettingSection(section, header, sectionId) {
    if (!section || !header) return;
    
    const willCollapse = !section.classList.contains('collapsed');
    section.classList.toggle('collapsed', willCollapse);
    header.setAttribute('aria-expanded', (!willCollapse).toString());
    updateSettingSectionState(sectionId, willCollapse);
}

function initializeSettingSections() {
    const sections = document.querySelectorAll('.setting-section');
    if (sections.length === 0) return;
    
    loadSettingSectionStateFromStorage();
    
    sections.forEach(section => {
        const sectionId = section.dataset.section;
        const header = section.querySelector('.setting-section-header');
        if (!sectionId || !header) return;
        
        const isCollapsed = sectionCollapseState[sectionId] === true;
        section.classList.toggle('collapsed', isCollapsed);
        header.setAttribute('aria-expanded', (!isCollapsed).toString());
        
        header.addEventListener('click', () => {
            toggleSettingSection(section, header, sectionId);
        });
    });
}

function initializeControlsPanel() {
    const controls = document.querySelector('.controls[data-collapsible="controls"]');
    if (!controls) return;
    
    const toggleButton = controls.querySelector('.controls-toggle');
    if (!toggleButton) return;
    
    const savedState = localStorage.getItem(CONTROLS_PANEL_STATE_KEY);
    const isCollapsed = savedState === 'true';
    applyControlsPanelState(isCollapsed);
    
    toggleButton.addEventListener('click', () => {
        const nextState = !controls.classList.contains('collapsed');
        applyControlsPanelState(nextState);
        localStorage.setItem(CONTROLS_PANEL_STATE_KEY, nextState ? 'true' : 'false');
    });
    
    function applyControlsPanelState(collapsed) {
        controls.classList.toggle('collapsed', collapsed);
        toggleButton.setAttribute('aria-expanded', (!collapsed).toString());
    }
}

function loadFromLocalStorage() {
    const savedVideos = localStorage.getItem('youtubeVideos');
    const savedChannels = localStorage.getItem('youtubeChannels');
    const savedLayout = localStorage.getItem('layout');
    const savedColumns = localStorage.getItem('gridColumns');
    const savedApiKey = localStorage.getItem('youtubeApiKey');
    const savedUpdateInterval = localStorage.getItem('updateIntervalMinutes');
    const savedAutoplay = localStorage.getItem('autoplayEnabled');
    const savedAutoMute = localStorage.getItem('autoMuteEnabled');
    const savedShowStatus = localStorage.getItem('showStatusBadge');
    const savedShowOnlyRegisteredChannels = localStorage.getItem('showOnlyRegisteredChannels');
    const savedAutoRemoveEnded = localStorage.getItem('autoRemoveEnded');
    const savedScrollPosition = localStorage.getItem(SCROLL_POSITION_KEY);
    
    if (savedVideos) {
        videos = JSON.parse(savedVideos);
    }
    
    if (savedChannels) {
        channels = JSON.parse(savedChannels);
        channels.forEach(channel => {
            if (channel.keywordFilter === undefined || channel.keywordFilter === null) {
                channel.keywordFilter = '';
            }
        });
    }
    
    if (savedLayout) {
        currentLayout = savedLayout;
        document.getElementById('layoutSelect').value = savedLayout;
    }
    
    if (savedColumns) {
        gridColumns = parseInt(savedColumns);
        document.getElementById('columnsSelect').value = savedColumns;
    }
    
    if (savedApiKey) {
        apiKey = savedApiKey;
    }
    
    if (savedUpdateInterval) {
        updateIntervalMinutes = parseInt(savedUpdateInterval);
    }
    
    if (savedAutoplay !== null) {
        autoplayEnabled = savedAutoplay === 'true';
    }
    
    if (savedAutoMute !== null) {
        autoMuteEnabled = savedAutoMute === 'true';
    }
    
    if (savedShowStatus !== null) {
        showStatusBadge = savedShowStatus === 'true';
    }
    
    if (savedShowOnlyRegisteredChannels !== null) {
        showOnlyRegisteredChannels = savedShowOnlyRegisteredChannels === 'true';
    }

    if (savedAutoRemoveEnded !== null) {
        autoRemoveEnded = savedAutoRemoveEnded === 'true';
    }
    
    if (savedScrollPosition !== null) {
        const parsedScroll = parseInt(savedScrollPosition, 10);
        if (!isNaN(parsedScroll)) {
            pendingScrollPosition = parsedScroll;
        } else {
            pendingScrollPosition = null;
        }
    } else {
        pendingScrollPosition = null;
    }
    
    // 読み込み後に重複チェック
    removeDuplicateVideos();
    
    // 重複削除後、LocalStorageに再保存
    saveToLocalStorage();
    
    // チャンネルがある場合は自動更新を開始
    if (channels.length > 0 && apiKey) {
        startAutoUpdate();
    }
    
    changeLayout();
    // changeLayout()内でrenderVideos()が呼ばれるため、ここでは呼ばない
}

// バックグラウンド再生を維持するための設定
// Page Visibility APIを使用してタブがアクティブになった時に最新位置にシーク
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // タブがアクティブになった時
        console.log('タブがアクティブになりました。ライブ配信を最新位置にシークします...');
        setTimeout(() => {
            seekToLive();
        }, 500); // 少し遅延させてから実行
    }
});

// チャンネル設定をエクスポート
function exportChannels() {
    if (channels.length === 0) {
        alert('エクスポートするチャンネルがありません');
        return;
    }
    
    const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        channels: channels.map(ch => ({
            channelId: ch.channelId,
            name: ch.name,
            keywordFilter: ch.keywordFilter || ''
        }))
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `youtube-channels-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    alert(`${channels.length}件のチャンネルをエクスポートしました`);
}

// チャンネル設定をインポート
async function importChannels(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
        const text = await file.text();
        const importData = JSON.parse(text);
        
        // データ検証
        if (!importData.channels || !Array.isArray(importData.channels)) {
            alert('無効なファイル形式です');
            return;
        }
        
        let addedCount = 0;
        let skippedCount = 0;
        
        for (const channelData of importData.channels) {
            const channelId = channelData.channelId;
            const keywordFilter = (channelData.keywordFilter || '').trim();

            // 既存チェック
            if (channels.some(ch => ch.channelId === channelId)) {
                skippedCount++;
                continue;
            }
            
            // チャンネルを追加
            if (apiKey) {
                const liveInfo = await fetchChannelLiveStream(channelId, keywordFilter);
                const channelName = channelData.name || await fetchChannelName(channelId);

                if (liveInfo && liveInfo.videoId) {
                    channels.push({
                        channelId: channelId,
                        name: channelName,
                        videoId: liveInfo.videoId,
                        status: liveInfo.status,
                        keywordFilter: keywordFilter
                    });

                    if (!videos.includes(liveInfo.videoId)) {
                        videos.push(liveInfo.videoId);
                    }
                    videoChannelMap[liveInfo.videoId] = channelId;
                } else {
                    channels.push({
                        channelId: channelId,
                        name: channelName,
                        videoId: null,
                        status: 'none',
                        keywordFilter: keywordFilter
                    });
                }
                addedCount++;
            } else {
                // APIキーがない場合でもチャンネル情報は保存
                channels.push({
                    channelId: channelId,
                    name: channelData.name || 'チャンネル',
                    videoId: null,
                    status: 'none',
                    keywordFilter: keywordFilter
                });
                addedCount++;
            }
        }
        
        // 重複削除
        removeDuplicateVideos();
        
        // 保存と更新
        saveToLocalStorage();
        renderVideos();
        renderChannelList();
        
        // 自動更新開始
        if (apiKey && channels.length > 0) {
            startAutoUpdate();
        }
        
        alert(`インポート完了\n追加: ${addedCount}件\nスキップ(重複): ${skippedCount}件`);
        
    } catch (error) {
        console.error('Import error:', error);
        alert('ファイルの読み込みに失敗しました: ' + error.message);
    }
    
    // ファイル入力をリセット
    event.target.value = '';
}

// 自動保存機能を有効化
window.addEventListener('beforeunload', () => {
    storeScrollPosition();
    saveToLocalStorage();
});

window.addEventListener('load', loadFromLocalStorage);
