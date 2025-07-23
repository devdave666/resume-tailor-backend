// services/PaymentService.js
// Enhanced payment processing service with comprehensive security

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { logger } = require('../config/database');
const UserRepository = require('../repositories/UserRepository');
const GenerationRepository = require('../repositories/GenerationRepository');

class PaymentService {
    
    constructor() {
        this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        this.clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
        
        // Token packages configuration
        this.tokenPackages = {
            starter: {
                tokens: 5,
                price: 500, // $5.00 in cents
                name: '5 Resume Tokens - Starter Pack',
                description: 'Perfect for trying out Resume Tailor'
            },
            standard: {
                tokens: 15,
                price: 1200, // $12.00 in cents (20% discount)
                name: '15 Resume Tokens - Standard Pack',
                description: 'Great value for regular users'
            },
            premium: {
                tokens: 30,
                price: 2000, // $20.00 in cents (33% discount)
                name: '30 Resume Tokens - Premium Pack',
                description: 'Best value for power users'
            }
        };
    }

    /**
     * Create a Stripe checkout session
     * @param {string} userId - User ID
     * @param {string} packageType - Token package type (starter, standard, premium)
     * @returns {Promise<Object>} Stripe session object
     */
    async createCheckoutSession(userId, packageType = 'starter') {
        try {
            // Validate package type
            if (!this.tokenPackages[packageType]) {
                throw new Error(`Invalid package type: ${packageType}`);
            }

            const packageInfo = this.tokenPackages[packageType];
            
            // Verify user exists
            const user = await UserRepository.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Create Stripe session
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: packageInfo.name,
                                description: packageInfo.description,
                                images: [], // Add product images if available
                            },
                            unit_amount: packageInfo.price,
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                success_url: `${this.clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${this.clientUrl}/payment/cancel`,
                client_reference_id: userId,
                customer_email: user.email,
                metadata: {
                    userId: userId,
                    packageType: packageType,
                    tokens: packageInfo.tokens.toString(),
                    timestamp: new Date().toISOString()
                },
                expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // 30 minutes
                billing_address_collection: 'required',
                shipping_address_collection: null,
                phone_number_collection: {
                    enabled: false
                },
                custom_text: {
                    submit: {
                        message: 'Secure payment processed by Stripe'
                    }
                }
            });

            // Log session creation
            logger.info('Payment session created', {
                userId,
                sessionId: session.id,
                packageType,
                tokens: packageInfo.tokens,
                amount: packageInfo.price,
                email: user.email
            });

            return {
                sessionId: session.id,
                url: session.url,
                package: {
                    type: packageType,
                    tokens: packageInfo.tokens,
                    price: packageInfo.price,
                    name: packageInfo.name
                }
            };

        } catch (error) {
            logger.error('Failed to create checkout session', {
                userId,
                packageType,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Handle Stripe webhook events
     * @param {Buffer} rawBody - Raw request body
     * @param {string} signature - Stripe signature header
     * @returns {Promise<Object>} Processing result
     */
    async handleWebhook(rawBody, signature) {
        let event;

        try {
            // Verify webhook signature
            event = stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
        } catch (err) {
            logger.error('Webhook signature verification failed', { error: err.message });
            throw new Error(`Webhook signature verification failed: ${err.message}`);
        }

        logger.info('Webhook event received', {
            type: event.type,
            id: event.id,
            created: event.created
        });

        try {
            switch (event.type) {
                case 'checkout.session.completed':
                    return await this.handleCheckoutCompleted(event.data.object);
                
                case 'checkout.session.expired':
                    return await this.handleCheckoutExpired(event.data.object);
                
                case 'payment_intent.succeeded':
                    return await this.handlePaymentSucceeded(event.data.object);
                
                case 'payment_intent.payment_failed':
                    return await this.handlePaymentFailed(event.data.object);
                
                case 'invoice.payment_succeeded':
                    return await this.handleInvoicePaymentSucceeded(event.data.object);
                
                default:
                    logger.info('Unhandled webhook event type', { type: event.type });
                    return { processed: false, message: 'Event type not handled' };
            }
        } catch (error) {
            logger.error('Webhook processing failed', {
                eventType: event.type,
                eventId: event.id,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Handle successful checkout completion
     * @param {Object} session - Stripe session object
     * @returns {Promise<Object>} Processing result
     */
    async handleCheckoutCompleted(session) {
        const userId = session.client_reference_id;
        const packageType = session.metadata?.packageType || 'starter';
        const tokensToAdd = parseInt(session.metadata?.tokens) || this.tokenPackages[packageType]?.tokens || 5;

        logger.info('Processing checkout completion', {
            sessionId: session.id,
            userId,
            packageType,
            tokensToAdd,
            amountTotal: session.amount_total
        });

        try {
            // Verify user exists
            const user = await UserRepository.findById(userId);
            if (!user) {
                throw new Error(`User not found: ${userId}`);
            }

            // Add tokens atomically
            const newBalance = await UserRepository.addTokens(userId, tokensToAdd);

            // Record the transaction
            await this.recordTransaction({
                userId,
                sessionId: session.id,
                packageType,
                tokensAdded: tokensToAdd,
                amountPaid: session.amount_total,
                currency: session.currency,
                customerEmail: session.customer_details?.email || user.email,
                paymentStatus: 'completed'
            });

            // Update user's Stripe customer ID if available
            if (session.customer && session.customer !== user.stripe_customer_id) {
                await UserRepository.updateStripeCustomerId(userId, session.customer);
            }

            logger.info('Checkout completed successfully', {
                userId,
                sessionId: session.id,
                tokensAdded,
                newBalance,
                email: user.email
            });

            return {
                processed: true,
                userId,
                tokensAdded,
                newBalance,
                message: 'Tokens added successfully'
            };

        } catch (error) {
            logger.error('Failed to process checkout completion', {
                sessionId: session.id,
                userId,
                error: error.message
            });

            // Record failed transaction
            await this.recordTransaction({
                userId,
                sessionId: session.id,
                packageType,
                tokensAdded: 0,
                amountPaid: session.amount_total,
                currency: session.currency,
                paymentStatus: 'failed',
                errorMessage: error.message
            }).catch(recordError => {
                logger.error('Failed to record failed transaction', { error: recordError.message });
            });

            throw error;
        }
    }

    /**
     * Handle expired checkout session
     * @param {Object} session - Stripe session object
     * @returns {Promise<Object>} Processing result
     */
    async handleCheckoutExpired(session) {
        const userId = session.client_reference_id;

        logger.info('Checkout session expired', {
            sessionId: session.id,
            userId,
            expiresAt: session.expires_at
        });

        // Record expired session
        await this.recordTransaction({
            userId,
            sessionId: session.id,
            packageType: session.metadata?.packageType || 'unknown',
            tokensAdded: 0,
            amountPaid: 0,
            paymentStatus: 'expired'
        }).catch(error => {
            logger.error('Failed to record expired session', { error: error.message });
        });

        return {
            processed: true,
            message: 'Session expiration recorded'
        };
    }

    /**
     * Handle successful payment intent
     * @param {Object} paymentIntent - Stripe payment intent object
     * @returns {Promise<Object>} Processing result
     */
    async handlePaymentSucceeded(paymentIntent) {
        logger.info('Payment intent succeeded', {
            paymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency
        });

        return {
            processed: true,
            message: 'Payment success logged'
        };
    }

    /**
     * Handle failed payment intent
     * @param {Object} paymentIntent - Stripe payment intent object
     * @returns {Promise<Object>} Processing result
     */
    async handlePaymentFailed(paymentIntent) {
        logger.warn('Payment intent failed', {
            paymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            lastPaymentError: paymentIntent.last_payment_error
        });

        return {
            processed: true,
            message: 'Payment failure logged'
        };
    }

    /**
     * Handle successful invoice payment (for subscriptions)
     * @param {Object} invoice - Stripe invoice object
     * @returns {Promise<Object>} Processing result
     */
    async handleInvoicePaymentSucceeded(invoice) {
        logger.info('Invoice payment succeeded', {
            invoiceId: invoice.id,
            customerId: invoice.customer,
            amountPaid: invoice.amount_paid
        });

        return {
            processed: true,
            message: 'Invoice payment logged'
        };
    }

    /**
     * Record transaction in database
     * @param {Object} transaction - Transaction details
     */
    async recordTransaction(transaction) {
        try {
            // This would typically go to a transactions table
            // For now, we'll use the api_usage table with special endpoint
            await GenerationRepository.recordApiUsage(
                transaction.userId,
                'payment_transaction',
                0, // No tokens used for payment
                {
                    sessionId: transaction.sessionId,
                    packageType: transaction.packageType,
                    tokensAdded: transaction.tokensAdded,
                    amountPaid: transaction.amountPaid,
                    currency: transaction.currency,
                    paymentStatus: transaction.paymentStatus,
                    errorMessage: transaction.errorMessage
                }
            );

            logger.debug('Transaction recorded', {
                userId: transaction.userId,
                sessionId: transaction.sessionId,
                status: transaction.paymentStatus
            });

        } catch (error) {
            logger.error('Failed to record transaction', {
                transaction,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get user's payment history
     * @param {string} userId - User ID
     * @returns {Promise<Array>} Payment history
     */
    async getPaymentHistory(userId) {
        try {
            // Get payment-related API usage records
            const history = await GenerationRepository.getApiUsageStats(userId, 365);
            
            return history.filter(record => record.endpoint === 'payment_transaction');

        } catch (error) {
            logger.error('Failed to get payment history', { userId, error: error.message });
            throw error;
        }
    }

    /**
     * Validate Stripe configuration
     * @returns {boolean} True if configuration is valid
     */
    validateConfiguration() {
        const required = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            logger.error('Missing required Stripe environment variables', { missing });
            return false;
        }

        // Check for test vs live keys
        const isTestKey = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
        const isLiveKey = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_');

        if (!isTestKey && !isLiveKey) {
            logger.error('Invalid Stripe secret key format');
            return false;
        }

        if (process.env.NODE_ENV === 'production' && isTestKey) {
            logger.warn('Using test Stripe key in production environment');
        }

        logger.info('Stripe configuration validated', { 
            keyType: isTestKey ? 'test' : 'live',
            environment: process.env.NODE_ENV 
        });

        return true;
    }

    /**
     * Get available token packages
     * @returns {Object} Available packages
     */
    getTokenPackages() {
        return this.tokenPackages;
    }
}

module.exports = new PaymentService();