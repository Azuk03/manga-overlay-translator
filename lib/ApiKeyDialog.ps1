Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Show-ApiKeyPrompt {
    param([string]$ExistingKey = "")

    $currentValue = $ExistingKey
    while ($true) {
        $form = New-Object System.Windows.Forms.Form
        $form.Text = "Manga Overlay Translator - Cau hinh API Key"
        $form.Size = New-Object System.Drawing.Size(420, 160)
        $form.StartPosition = "CenterScreen"
        $form.FormBorderStyle = "FixedDialog"
        $form.MaximizeBox = $false

        $label = New-Object System.Windows.Forms.Label
        $label.Text = "Dan OpenAI API key cua ban (bat dau bang sk-):"
        $label.AutoSize = $true
        $label.Location = New-Object System.Drawing.Point(10, 15)
        $form.Controls.Add($label)

        $textbox = New-Object System.Windows.Forms.TextBox
        $textbox.Text = $currentValue
        $textbox.Location = New-Object System.Drawing.Point(10, 40)
        $textbox.Width = 380
        $form.Controls.Add($textbox)

        $okButton = New-Object System.Windows.Forms.Button
        $okButton.Text = "OK"
        $okButton.Location = New-Object System.Drawing.Point(230, 90)
        $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
        $form.Controls.Add($okButton)
        $form.AcceptButton = $okButton

        $cancelButton = New-Object System.Windows.Forms.Button
        $cancelButton.Text = "Huy"
        $cancelButton.Location = New-Object System.Drawing.Point(315, 90)
        $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
        $form.Controls.Add($cancelButton)
        $form.CancelButton = $cancelButton

        $result = $form.ShowDialog()
        if ($result -eq [System.Windows.Forms.DialogResult]::Cancel) {
            return $null
        }

        $key = $textbox.Text.Trim()
        $currentValue = $textbox.Text
        if (Test-ApiKeyFormat -Key $key) {
            return $key
        }

        [System.Windows.Forms.MessageBox]::Show(
            "API key khong hop le. Phai bat dau bang 'sk-' va khong duoc de trong.",
            "Loi",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}
