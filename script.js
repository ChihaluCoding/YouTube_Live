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

// YouTube IFrame APIを読み込む
const tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

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
    autoRemoveEnded = newAutoRemoveEnded;
    
    localStorage.setItem('autoplayEnabled', autoplayEnabled);
    localStorage.setItem('autoMuteEnabled', autoMuteEnabled);
    localStorage.setItem('showStatusBadge', showStatusBadge);
    localStorage.setItem('autoRemoveEnded', autoRemoveEnded);
    
    // モーダルを閉じる
    closeSettings();
    
    // 設定変更を反映するため再描画
    renderVideos();
    
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
    const liveVideoId = await fetchChannelLiveStream(channelId);
    
    // チャンネル名を取得
    const channelName = await fetchChannelName(channelId);
    
    if (liveVideoId) {
        // 既に同じ動画が追加されているかチェック
        if (videos.includes(liveVideoId)) {
            alert('このライブ配信は既に追加されています');
            input.value = '';
            return;
        }
        
        channels.push({
            channelId: channelId,
            name: channelName,
            videoId: liveVideoId,
            status: 'live'
        });
        
        videos.push(liveVideoId);
    } else {
        // ライブ配信がない場合でもチャンネルを登録
        channels.push({
            channelId: channelId,
            name: channelName,
            videoId: null,
            status: 'none'
        });
        alert('現在このチャンネルでライブ配信は行われていません。定期的にチェックします。');
    }
    
    input.value = '';
    
    // 重複チェック
    removeDuplicateVideos();
    
    renderVideos();
    
    // 自動更新を開始
    startAutoUpdate();
}

// チャンネルのライブ配信を取得
async function fetchChannelLiveStream(channelId) {
    try {
        // まず、チャンネルの配信中のライブを検索
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`;
        
        const response = await fetch(searchUrl);
        const data = await response.json();
        
        if (data.error) {
            console.error('API Error:', data.error);
            alert(`APIエラー: ${data.error.message}`);
            return null;
        }
        
        if (data.items && data.items.length > 0) {
            return data.items[0].id.videoId;
        }
        
        // ライブ配信がない場合、予定されているライブを検索
        const upcomingUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=upcoming&type=video&order=date&maxResults=1&key=${apiKey}`;
        
        const upcomingResponse = await fetch(upcomingUrl);
        const upcomingData = await upcomingResponse.json();
        
        if (upcomingData.items && upcomingData.items.length > 0) {
            return upcomingData.items[0].id.videoId;
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
            
            if (snippet.liveBroadcastContent === 'live') {
                return { status: 'live', title: snippet.title };
            } else if (snippet.liveBroadcastContent === 'upcoming') {
                return { status: 'upcoming', title: snippet.title };
            } else {
                return { status: 'ended', title: snippet.title };
            }
        }
        
        return { status: 'unknown', title: '' };
    } catch (error) {
        console.error('Error getting video status:', error);
        return { status: 'error', title: '' };
    }
}

// 全チャンネルを更新
async function updateAllChannels() {
    let hasChanges = false;
    
    for (let channel of channels) {
        const liveVideoId = await fetchChannelLiveStream(channel.channelId);
        
        if (liveVideoId && liveVideoId !== channel.videoId) {
            // 新しいライブ配信が見つかった
            if (channel.videoId) {
                // 古い動画を削除
                videos = videos.filter(id => id !== channel.videoId);
            }
            
            channel.videoId = liveVideoId;
            channel.status = 'live';
            
            if (!videos.includes(liveVideoId)) {
                videos.push(liveVideoId);
            }
            hasChanges = true;
        } else if (!liveVideoId && channel.videoId) {
            // ライブ配信が終了した
            if (autoRemoveEnded) {
                // 自動削除が有効な場合、動画を削除
                videos = videos.filter(id => id !== channel.videoId);
                console.log(`ライブ配信が終了したため削除しました: チャンネル ${channel.channelId}`);
            }
            channel.videoId = null;
            channel.status = 'none';
            hasChanges = true;
        }
    }
    
    // チャンネルから追加された動画のステータスをチェック（自動削除が有効な場合のみ）
    if (autoRemoveEnded) {
        for (let i = videos.length - 1; i >= 0; i--) {
            const videoId = videos[i];
            const channelInfo = channels.find(ch => ch.videoId === videoId);
            
            if (apiKey && channelInfo) {
                const videoStatus = await getVideoStatus(videoId);
                
                // 終了した配信を削除
                if (videoStatus.status === 'ended') {
                    console.log(`配信が終了したため削除: ${videoId} - ${videoStatus.title}`);
                    videos.splice(i, 1);
                    
                    // チャンネル情報も更新
                    channelInfo.videoId = null;
                    channelInfo.status = 'none';
                    hasChanges = true;
                }
            }
        }
    }
    
    // 重複チェックと削除
    removeDuplicateVideos();
    
    if (hasChanges) {
        renderVideos();
    }
}

// 重複した動画IDを削除する関数
function removeDuplicateVideos() {
    // 重複を削除（Setを使用）
    const uniqueVideos = [...new Set(videos)];
    
    // 重複があった場合のみログ出力
    if (uniqueVideos.length < videos.length) {
        console.log(`重複した動画を削除しました: ${videos.length - uniqueVideos.length}件`);
    }
    
    videos = uniqueVideos;
    
    // チャンネル情報も重複チェック
    // 複数のチャンネルが同じvideoIdを持っている場合、最初の1つだけを残す
    const seenVideoIds = new Set();
    channels = channels.filter(channel => {
        if (!channel.videoId) return true; // videoIdがnullの場合は保持
        
        if (seenVideoIds.has(channel.videoId)) {
            console.log(`重複したチャンネルを統合: ${channel.channelId}`);
            return false; // 重複なので削除
        }
        
        seenVideoIds.add(channel.videoId);
        return true;
    });
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
            updateAllChannels();
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

// 動画を追加する関数
function addVideo() {
    const input = document.getElementById('videoInput');
    const videoId = extractVideoId(input.value.trim());
    
    if (!videoId) {
        alert('有効なYouTube URLまたは動画IDを入力してください');
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
    const container = document.getElementById('videoContainer');
    
    if (videos.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>動画がありません</h3>
                <p>YouTube動画のURLまたはChannel IDを入力して追加してください</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    // 各動画のステータスを取得して表示
    for (let i = 0; i < videos.length; i++) {
        const videoId = videos[i];
        const wrapper = document.createElement('div');
        wrapper.className = 'video-wrapper';
        
        // PIPレイアウトの場合、2つ目以降をpip-secondaryクラスに
        if (currentLayout === 'pip' && i > 0) {
            wrapper.className += ' pip-secondary';
        }
        
        // チャンネルから追加された動画かチェック
        const channelInfo = channels.find(ch => ch.videoId === videoId);
        let statusHtml = '';
        
        // ステータスバッジを表示する設定の場合のみ表示
        if (showStatusBadge && apiKey && channelInfo) {
            const videoStatus = await getVideoStatus(videoId);
            let statusClass = '';
            let statusText = '';
            
            if (videoStatus.status === 'live') {
                statusClass = 'status-live';
                statusText = '🔴 配信中';
            } else if (videoStatus.status === 'upcoming') {
                statusClass = 'status-upcoming';
                statusText = '🔔 予定';
            } else if (videoStatus.status === 'ended') {
                statusClass = 'status-ended';
                statusText = '⏹️ 終了';
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
                <iframe
                    src="https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=${autoplay}&mute=${mute}"
                    frameborder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowfullscreen
                ></iframe>
            </div>
        `;
        
        container.appendChild(wrapper);
    }
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
        if (channel.videoId) {
            statusText = `📺 現在の配信: ${channel.videoId}`;
        }
        
        channelItem.innerHTML = `
            <button class="channel-remove-btn" onclick="removeChannel('${channel.channelId}')" title="削除">×</button>
            <div class="channel-name">${channel.name || 'チャンネル'}</div>
            <div class="channel-id">ID: ${channel.channelId}</div>
            <div class="channel-status">${statusText}</div>
        `;
        
        channelListContainer.appendChild(channelItem);
    });
}

// チャンネルを削除する関数
function removeChannel(channelId) {
    if (confirm('このチャンネルを削除しますか?')) {
        // チャンネルを配列から削除
        channels = channels.filter(ch => ch.channelId !== channelId);
        
        // そのチャンネルから追加された動画も削除
        const channel = channels.find(ch => ch.channelId === channelId);
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
    
    // 初期表示
    renderVideos();
});

// ローカルストレージに保存（オプション機能）
function saveToLocalStorage() {
    localStorage.setItem('youtubeVideos', JSON.stringify(videos));
    localStorage.setItem('youtubeChannels', JSON.stringify(channels));
    localStorage.setItem('layout', currentLayout);
    localStorage.setItem('gridColumns', gridColumns);
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
    const savedAutoRemoveEnded = localStorage.getItem('autoRemoveEnded');
    
    if (savedVideos) {
        videos = JSON.parse(savedVideos);
    }
    
    if (savedChannels) {
        channels = JSON.parse(savedChannels);
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
    
    if (savedAutoRemoveEnded !== null) {
        autoRemoveEnded = savedAutoRemoveEnded === 'true';
    }
    
    // チャンネルがある場合は自動更新を開始
    if (channels.length > 0 && apiKey) {
        startAutoUpdate();
    }
    
    changeLayout();
    renderVideos();
}

// 自動保存機能を有効化
window.addEventListener('beforeunload', saveToLocalStorage);
window.addEventListener('load', loadFromLocalStorage);
