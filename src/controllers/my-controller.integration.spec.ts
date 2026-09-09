import {
	describe, it, expect, beforeEach,
	afterEach,
} from 'vitest';
import {type FastifyInstance} from 'fastify';
import supertest from 'supertest';
import {eq} from 'drizzle-orm';
import {type DeepMockProxy, mockDeep} from 'vitest-mock-extended';
import {asValue} from 'awilix';
import {type INotificationService} from '@/services/notifications.port.js';
import {
	type ProductInsert,
	products,
	orders,
	ordersToProducts,
} from '@/db/schema.js';
import {type Database} from '@/db/type.js';
import {buildFastify} from '@/fastify.js';

describe('MyController Integration Tests', () => {
	let fastify: FastifyInstance;
	let database: Database;
	let notificationServiceMock: DeepMockProxy<INotificationService>;

	beforeEach(async () => {
		notificationServiceMock = mockDeep<INotificationService>();

		fastify = await buildFastify();
		fastify.diContainer.register({
			ns: asValue(notificationServiceMock as INotificationService),
		});
		await fastify.ready();
		database = fastify.database;
	});
	afterEach(async () => {
		await fastify.close();
	});

	it('ProcessOrderShouldReturn', async () => {
		const client = supertest(fastify.server);
		const allProducts = createProducts();
		const [
			normalInStock, normalOutOfStock, expirableActive, expirableExpired, seasonalInSeason, seasonalNotStarted,
		] = allProducts;

		const {orderId, productIds} = database.transaction(tx => {
			const productList = tx.insert(products).values(allProducts).returning({productId: products.id}).all();
			const order = tx.insert(orders).values([{}]).returning({orderId: orders.id}).get();
			tx.insert(ordersToProducts).values(productList.map(p => ({orderId: order.orderId, productId: p.productId}))).run();
			return {orderId: order.orderId, productIds: productList.map(p => p.productId)};
		});
		const [
			normalInStockId, normalOutOfStockId, expirableActiveId, expirableExpiredId, seasonalInSeasonId, seasonalNotStartedId,
		] = productIds;

		await client.post(`/orders/${orderId}/processOrder`).expect(200).expect('Content-Type', /application\/json/);

		const resultOrder = await database.query.orders.findFirst({where: eq(orders.id, orderId)});
		expect(resultOrder!.id).toBe(orderId);

		const getProduct = async (id: number) => database.query.products.findFirst({where: eq(products.id, id)});

		// NORMAL, in stock -> decremented, no notification for this product
		expect((await getProduct(normalInStockId))!.available).toBe(normalInStock.available - 1);
		expect(notificationServiceMock.sendDelayNotification).not.toHaveBeenCalledWith(normalInStock.leadTime, normalInStock.name);

		// NORMAL, out of stock, leadTime > 0 -> delay notification, stock left untouched
		expect((await getProduct(normalOutOfStockId))!.available).toBe(0);
		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(normalOutOfStock.leadTime, normalOutOfStock.name);

		// EXPIRABLE, not expired -> decremented, no notification
		expect((await getProduct(expirableActiveId))!.available).toBe(expirableActive.available - 1);
		expect(notificationServiceMock.sendExpirationNotification).not.toHaveBeenCalledWith(expirableActive.name, expect.anything());

		// EXPIRABLE, expired -> expiration notification, stock zeroed
		expect((await getProduct(expirableExpiredId))!.available).toBe(0);
		expect(notificationServiceMock.sendExpirationNotification).toHaveBeenCalledWith(expirableExpired.name, expirableExpired.expiryDate);

		// SEASONAL, in season -> decremented, no notification
		expect((await getProduct(seasonalInSeasonId))!.available).toBe(seasonalInSeason.available - 1);

		// SEASONAL, season not started yet -> out-of-stock notification, but stock left UNCHANGED
		// (current behavior — a known inconsistency flagged in REFACTORING_PLAN.md #2, pinned here on purpose)
		expect((await getProduct(seasonalNotStartedId))!.available).toBe(seasonalNotStarted.available);
		expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith(seasonalNotStarted.name);
	});

	function createProducts(): ProductInsert[] {
		const d = 24 * 60 * 60 * 1000;
		return [
			{
				leadTime: 15, available: 30, type: 'NORMAL', name: 'USB Cable',
			},
			{
				leadTime: 10, available: 0, type: 'NORMAL', name: 'USB Dongle',
			},
			{
				leadTime: 15, available: 30, type: 'EXPIRABLE', name: 'Butter', expiryDate: new Date(Date.now() + (26 * d)),
			},
			{
				leadTime: 90, available: 6, type: 'EXPIRABLE', name: 'Milk', expiryDate: new Date(Date.now() - (2 * d)),
			},
			{
				leadTime: 15, available: 30, type: 'SEASONAL', name: 'Watermelon', seasonStartDate: new Date(Date.now() - (2 * d)), seasonEndDate: new Date(Date.now() + (58 * d)),
			},
			{
				leadTime: 15, available: 30, type: 'SEASONAL', name: 'Grapes', seasonStartDate: new Date(Date.now() + (180 * d)), seasonEndDate: new Date(Date.now() + (240 * d)),
			},
		];
	}
});
