import Capacitor
import Foundation
import StoreKit

/**
 * The full set, bought and owned, through StoreKit 2.
 *
 * No third party and no server of our own. `Transaction.currentEntitlements`
 * hands back what this Apple ID owns, already checked against Apple's
 * signature on the device, which is the whole reason this app can take money
 * and still say truthfully that nothing leaves the phone.
 *
 * The four methods mirror the `Store` interface in state/purchases.ts. None of
 * them reject on an ordinary failure: a store that cannot be reached is an
 * answer, not an error, and the screen has copy for every one of them. Reject
 * is reserved for being called wrongly.
 *
 * Deployment target is 15.0 and every API used here is iOS 15, so there are no
 * availability guards.
 */
@objc(FullSetStorePlugin)
public class FullSetStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FullSetStorePlugin"
    public let jsName = "FullSetStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "entitled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "price", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    private var updates: Task<Void, Never>?

    /**
     * Transactions can arrive without anyone having pressed anything here: an
     * Ask to Buy request approved by a parent hours later, or a purchase made
     * on another device. StoreKit hands those to `Transaction.updates` and
     * expects them finished; one that is never finished is redelivered on
     * every launch for good. Started once, for the life of the app.
     */
    override public func load() {
        updates = Task.detached {
            for await update in Transaction.updates {
                if case .verified(let transaction) = update {
                    await transaction.finish()
                }
            }
        }
    }

    deinit {
        updates?.cancel()
    }

    @objc func entitled(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            call.reject("productId is required")
            return
        }
        Task {
            call.resolve(["entitled": await Self.owns(productId)])
        }
    }

    /**
     * The store's own price, already localised and already correct for
     * whichever storefront the user is actually in. The constant in unlock.ts
     * is only what gets shown when this cannot be reached.
     */
    @objc func price(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            call.reject("productId is required")
            return
        }
        Task {
            let products = try? await Product.products(for: [productId])
            guard let product = products?.first else {
                call.resolve([:])
                return
            }
            call.resolve(["price": product.displayPrice])
        }
    }

    @objc func buy(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            call.reject("productId is required")
            return
        }
        Task {
            guard let product = try? await Product.products(for: [productId]).first else {
                call.resolve([
                    "outcome": "unavailable",
                    "message": "the App Store returned no product for \(productId)"
                ])
                return
            }
            do {
                switch try await product.purchase() {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        // Finishing is what tells StoreKit the goods have been
                        // handed over. Skip it and the transaction comes back
                        // on every launch.
                        await transaction.finish()
                        call.resolve(["outcome": "owned"])
                    case .unverified(_, let error):
                        // The signature did not check out. Someone is playing
                        // games, or something is very wrong; either way this
                        // is not a purchase.
                        call.resolve([
                            "outcome": "failed",
                            "message": "unverified transaction: \(error)"
                        ])
                    }
                case .userCancelled:
                    call.resolve(["outcome": "cancelled"])
                case .pending:
                    // Ask to Buy, waiting on a parent. The purchase is not
                    // finished and is not refused; it arrives later through
                    // the updates task above.
                    call.resolve(["outcome": "pending"])
                @unknown default:
                    call.resolve([
                        "outcome": "failed",
                        "message": "StoreKit returned a result this build does not know"
                    ])
                }
            } catch {
                // Reported rather than swallowed. There is no console on a
                // handset running a TestFlight build, so an error kept to
                // itself here is an error nobody can ever act on.
                call.resolve(["outcome": "failed", "message": "\(error)"])
            }
        }
    }

    /**
     * A new handset, a wiped one, a restored backup. `AppStore.sync()` pulls
     * the account's history down; the answer still comes from the entitlements
     * afterwards, because sync succeeding does not by itself mean anything was
     * found. A cancelled sign-in throws, and asking anyway is right: the
     * entitlement may already be on the device.
     */
    @objc func restore(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            call.reject("productId is required")
            return
        }
        Task {
            try? await AppStore.sync()
            let owned = await Self.owns(productId)
            call.resolve(["outcome": owned ? "owned" : "nothing-to-restore"])
        }
    }

    /**
     * Whether this Apple ID owns the product right now.
     *
     * Unverified entitlements are ignored rather than trusted, and a revoked
     * one (a refund) does not count — a refunded purchase is not a purchase.
     */
    private static func owns(_ productId: String) async -> Bool {
        for await entitlement in Transaction.currentEntitlements {
            guard case .verified(let transaction) = entitlement else { continue }
            if transaction.productID == productId && transaction.revocationDate == nil {
                return true
            }
        }
        return false
    }
}
