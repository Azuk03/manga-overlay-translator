# lib/ConfigDialog.ps1
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Test-KeyFormat {
    param([string]$Key)
    if ([string]::IsNullOrWhiteSpace($Key)) { return $false }
    return $Key.Trim().StartsWith('sk-')
}

function Get-KeyCheckVerdict {
    param([int]$StatusCode, [bool]$NetworkFailed)
    if ($NetworkFailed) { return 'network' }
    if ($StatusCode -eq 200) { return 'ok' }
    if ($StatusCode -eq 401) { return 'invalid' }
    return 'unknown'
}

function Test-OpenAiKey {
    param([string]$Key, [string]$BaseUrl, [scriptblock]$Invoker)
    try {
        $code = & $Invoker $Key $BaseUrl
    } catch {
        return Get-KeyCheckVerdict -StatusCode 0 -NetworkFailed $true
    }
    return Get-KeyCheckVerdict -StatusCode ([int]$code) -NetworkFailed $false
}

# Tra ve ma HTTP lay tu WebException, hoac 0 neu khong he co phan hoi
# (tuc la loi mang that su, khong phai server tra loi loi).
function Get-StatusCodeFromWebException {
    param([object]$Exception)
    if ($null -eq $Exception) { return 0 }
    $resp = $Exception.Response
    if ($null -eq $resp) { return 0 }
    return [int]$resp.StatusCode
}

function Invoke-OpenAiModelsCall {
    param([string]$Key, [string]$BaseUrl)
    $url = "$BaseUrl/models"
    try {
        $r = Invoke-WebRequest -Uri $url -Headers @{ Authorization = "Bearer $Key" } -UseBasicParsing -TimeoutSec 20
        return [int]$r.StatusCode
    } catch [System.Net.WebException] {
        $code = Get-StatusCodeFromWebException -Exception $_.Exception
        if ($code -gt 0) { return $code }
        throw
    }
}

function Save-ConfigToEnv {
    param([string]$EnvPath, [hashtable]$Values)
    foreach ($k in $Values.Keys) { Set-EnvValue -Path $EnvPath -Key $k -Value $Values[$k] }
}

function Show-ConfigDialog {
    param([string]$EnvPath)
    $existing = Read-EnvFile -Path $EnvPath

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Manga Translator — Cấu hình'
    $form.Size = New-Object System.Drawing.Size(520, 420)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false

    $lblKey = New-Object System.Windows.Forms.Label
    $lblKey.Text = 'Khoá API OpenAI (bắt đầu bằng sk-):'
    $lblKey.Location = New-Object System.Drawing.Point(12, 15)
    $lblKey.AutoSize = $true
    $form.Controls.Add($lblKey)

    $txtKey = New-Object System.Windows.Forms.TextBox
    $txtKey.Location = New-Object System.Drawing.Point(12, 38)
    $txtKey.Width = 380
    $txtKey.UseSystemPasswordChar = $true
    if ($existing.ContainsKey('OPENAI_API_KEY')) { $txtKey.Text = $existing['OPENAI_API_KEY'] }
    $form.Controls.Add($txtKey)

    $btnShow = New-Object System.Windows.Forms.Button
    $btnShow.Text = 'Hiện'
    $btnShow.Location = New-Object System.Drawing.Point(400, 36)
    $btnShow.Width = 80
    $btnShow.Add_Click({ $txtKey.UseSystemPasswordChar = -not $txtKey.UseSystemPasswordChar })
    $form.Controls.Add($btnShow)

    $btnCheck = New-Object System.Windows.Forms.Button
    $btnCheck.Text = 'Kiểm tra khoá'
    $btnCheck.Location = New-Object System.Drawing.Point(12, 70)
    $btnCheck.Width = 120
    $lblVerdict = New-Object System.Windows.Forms.Label
    $lblVerdict.Location = New-Object System.Drawing.Point(140, 75)
    $lblVerdict.AutoSize = $true
    $btnCheck.Add_Click({
        $base = 'https://api.openai.com/v1'
        $verdict = Test-OpenAiKey -Key $txtKey.Text -BaseUrl $base -Invoker ${function:Invoke-OpenAiModelsCall}
        $msg = @{
            'ok'      = 'Khoá dùng được.'
            'invalid' = 'Khoá bị từ chối (401). Kiểm tra lại.'
            'network' = 'Không nối được mạng — chưa kết luận được về khoá.'
            'unknown' = 'Máy chủ trả mã lạ, chưa kết luận được.'
        }[$verdict]
        $lblVerdict.Text = $msg
    })
    $form.Controls.Add($btnCheck)
    $form.Controls.Add($lblVerdict)

    $lblModel = New-Object System.Windows.Forms.Label
    $lblModel.Text = 'Model dịch:'
    $lblModel.Location = New-Object System.Drawing.Point(12, 110)
    $lblModel.AutoSize = $true
    $form.Controls.Add($lblModel)

    $cmbModel = New-Object System.Windows.Forms.ComboBox
    $cmbModel.Location = New-Object System.Drawing.Point(12, 133)
    $cmbModel.Width = 468
    $cmbModel.DropDownStyle = 'DropDown'
    # Nhãn lấy nguyên văn từ .env.example, không viết lại.
    $cmbModel.Items.AddRange(@('gpt-4o', 'gpt-4o-mini')) | Out-Null
    $cmbModel.Text = 'gpt-4o'
    if ($existing.ContainsKey('OPENAI_MODEL')) { $cmbModel.Text = $existing['OPENAI_MODEL'] }
    $form.Controls.Add($cmbModel)

    $lblHint = New-Object System.Windows.Forms.Label
    $lblHint.Text = "gpt-4o: chọn đại từ/xưng hô tiếng Việt tự nhiên hơn hẳn, vài xu mỗi trang.`ngpt-4o-mini: rẻ và nhanh hơn nhưng dịch máy móc hơn."
    $lblHint.Location = New-Object System.Drawing.Point(12, 160)
    $lblHint.AutoSize = $true
    $form.Controls.Add($lblHint)

    $grpAdv = New-Object System.Windows.Forms.GroupBox
    $grpAdv.Text = 'Nâng cao (không cần điền)'
    $grpAdv.Location = New-Object System.Drawing.Point(12, 200)
    $grpAdv.Size = New-Object System.Drawing.Size(468, 130)
    $form.Controls.Add($grpAdv)

    $advKeys = @('OPENAI_API_BASE', 'GEMINI_API_KEY', 'DEEPL_AUTH_KEY')
    $advBoxes = @{}
    $y = 22
    foreach ($k in $advKeys) {
        $l = New-Object System.Windows.Forms.Label
        $l.Text = $k
        $l.Location = New-Object System.Drawing.Point(10, ($y + 3))
        $l.Width = 140
        $grpAdv.Controls.Add($l)
        $t = New-Object System.Windows.Forms.TextBox
        $t.Location = New-Object System.Drawing.Point(155, $y)
        $t.Width = 300
        if ($existing.ContainsKey($k)) { $t.Text = $existing[$k] }
        $grpAdv.Controls.Add($t)
        $advBoxes[$k] = $t
        $y += 30
    }

    $lblWarn = New-Object System.Windows.Forms.Label
    $lblWarn.Text = 'Gemini và DeepL chưa từng được kiểm chứng thực tế.'
    $lblWarn.Location = New-Object System.Drawing.Point(10, $y)
    $lblWarn.AutoSize = $true
    $grpAdv.Controls.Add($lblWarn)

    $btnOk = New-Object System.Windows.Forms.Button
    $btnOk.Text = 'Lưu'
    $btnOk.Location = New-Object System.Drawing.Point(300, 345)
    $btnOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Controls.Add($btnOk)
    $form.AcceptButton = $btnOk

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text = 'Huỷ'
    $btnCancel.Location = New-Object System.Drawing.Point(390, 345)
    $btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($btnCancel)
    $form.CancelButton = $btnCancel

    while ($true) {
        if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $false }
        if (Test-KeyFormat -Key $txtKey.Text) { break }
        [System.Windows.Forms.MessageBox]::Show(
            'Khoá API không hợp lệ. Phải bắt đầu bằng "sk-" và không được để trống.',
            'Lỗi', 'OK', 'Error') | Out-Null
    }

    $values = @{ OPENAI_API_KEY = $txtKey.Text.Trim(); OPENAI_MODEL = $cmbModel.Text.Trim() }
    foreach ($k in $advKeys) { $values[$k] = $advBoxes[$k].Text.Trim() }
    Save-ConfigToEnv -EnvPath $EnvPath -Values $values
    return $true
}
