interface EmailServiceConfig {
    baseUrl: string
    apiKey: string
}

interface SendEmailInput {
    to: string | string[]
    subject: string
    templateType: 'simple' | 'welcome' | 'reset-password' | 'forgot-password' | 'otp'
    text?: string
    link?: string
    value?: string
    from?: string
}

export class EmailService {
    private config: EmailServiceConfig

    constructor(config: EmailServiceConfig) {
        this.config = config
    }

    async send(input: SendEmailInput): Promise<{ success: boolean; messageId?: string }> {
        const response = await fetch(`${this.config.baseUrl}/api/mail`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.config.apiKey,
            },
            body: JSON.stringify(input),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(`Email service error: ${response.status} ${JSON.stringify(error)}`)
        }

        return response.json()
    }

    async sendPasswordResetEmail(email: string, resetLink: string): Promise<void> {
        await this.send({
            to: email,
            subject: 'Réinitialisation de votre mot de passe TechWatch',
            templateType: 'forgot-password',
            text: 'Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le lien ci-dessous pour en choisir un nouveau (valable 1 heure).',
            link: resetLink,
        })
    }
}

let emailServiceInstance: EmailService | null = null

export function getEmailService(): EmailService {
    if (!emailServiceInstance) {
        const baseUrl = process.env.MAIL_SERVICE_URL
        const apiKey = process.env.MAIL_API_KEY

        if (!baseUrl || !apiKey) {
            throw new Error('MAIL_SERVICE_URL and MAIL_API_KEY must be configured')
        }

        emailServiceInstance = new EmailService({ baseUrl, apiKey })
    }

    return emailServiceInstance
}