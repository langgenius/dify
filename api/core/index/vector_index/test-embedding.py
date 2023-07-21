import numpy as np
import sklearn.decomposition
import pickle
import time


# Apply 'Algorithm 1' to the ada-002 embeddings to make them isotropic, taken from the paper:
# ALL-BUT-THE-TOP: SIMPLE AND EFFECTIVE POST- PROCESSING FOR WORD REPRESENTATIONS
# Jiaqi Mu, Pramod Viswanath

# This uses Principal Component Analysis (PCA) to 'evenly distribute' the embedding vectors (make them isotropic)
# For more information on PCA, see https://jamesmccaffrey.wordpress.com/2021/07/16/computing-pca-using-numpy-without-scikit/


# get the file pointer of the pickle containing the embeddings
fp = open('/path/to/your/data/Embedding-Latest.pkl', 'rb')


# the embedding data here is a dict consisting of key / value pairs
# the key is the hash of the message (SHA3-256), the value is the embedding from ada-002 (array of dimension 1536)
# the hash can be used to lookup the orignal text in a database
E = pickle.load(fp) # load the data into memory

# seperate the keys (hashes) and values (embeddings) into seperate vectors
K = list(E.keys()) # vector of all the hash values
X = np.array(list(E.values())) # vector of all the embeddings, converted to numpy arrays


# list the total number of embeddings
# this can be truncated if there are too many embeddings to do PCA on
print(f"Total number of embeddings: {len(X)}")

# get dimension of embeddings, used later
Dim = len(X[0])

# flash out the first few embeddings
print("First two embeddings are: ")
print(X[0])
print(f"First embedding length: {len(X[0])}")
print(X[1])
print(f"Second embedding length: {len(X[1])}")


# compute the mean of all the embeddings, and flash the result
mu = np.mean(X, axis=0) # same as mu in paper
print(f"Mean embedding vector: {mu}")
print(f"Mean embedding vector length: {len(mu)}")


# subtract the mean vector from each embedding vector ... vectorized in numpy
X_tilde = X - mu # same as v_tilde(w) in paper



# do the heavy lifting of extracting the principal components
# note that this is a function of the embeddings you currently have here, and this set may grow over time
# therefore the PCA basis vectors may change over time, and your final isotropic embeddings may drift over time
# but the drift should stabilize after you have extracted enough embedding data to characterize the nature of the embedding engine
print(f"Performing PCA on the normalized embeddings ...")
pca = sklearn.decomposition.PCA()  # new object
TICK = time.time() # start timer
pca.fit(X_tilde) # do the heavy lifting!
TOCK = time.time() # end timer
DELTA = TOCK - TICK

print(f"PCA finished in {DELTA} seconds ...")

# dimensional reduction stage (the only hyperparameter)
# pick max dimension of PCA components to express embddings
# in general this is some integer less than or equal to the dimension of your embeddings
# it could be set as a high percentile, say 95th percentile of pca.explained_variance_ratio_
# but just hardcoding a constant here
D = 15 # hyperparameter on dimension (out of 1536 for ada-002), paper recommeds D = Dim/100


# form the set of v_prime(w), which is the final embedding
# this could be vectorized in numpy to speed it up, but coding it directly here in a double for-loop to avoid errors and to be transparent
E_prime = dict() # output dict of the new embeddings
N = len(X_tilde)
N10 = round(N/10)
U = pca.components_ # set of PCA basis vectors, sorted by most significant to least significant
print(f"Shape of full set of PCA componenents {U.shape}")
U = U[0:D,:] # take the top D dimensions (or take them all if D is the size of the embedding vector)
print(f"Shape of downselected PCA componenents {U.shape}")
for ii in range(N):
    v_tilde = X_tilde[ii]
    v = X[ii]
    v_projection = np.zeros(Dim) # start to build the projection
    # project the original embedding onto the PCA basis vectors, use only first D dimensions
    for jj in range(D):
        u_jj = U[jj,:] # vector
        v_jj = np.dot(u_jj,v) # scaler
        v_projection += v_jj*u_jj # vector
    v_prime = v_tilde - v_projection # final embedding vector
    v_prime = v_prime/np.linalg.norm(v_prime) # create unit vector
    E_prime[K[ii]] = v_prime

    if (ii%N10 == 0) or (ii == N-1):
        print(f"Finished with {ii+1} embeddings out of {N} ({round(100*ii/N)}% done)")


# save as new pickle
print("Saving new pickle ...")
embeddingName = '/path/to/your/data/Embedding-Latest-Isotropic.pkl'
with open(embeddingName, 'wb') as f:  # Python 3: open(..., 'wb')
    pickle.dump([E_prime,mu,U], f)
    print(embeddingName)

print("Done!")

# When working with live data with a new embedding from ada-002, be sure to tranform it first with this function before comparing it
#
def projectEmbedding(v,mu,U):
    v = np.array(v)
    v_tilde = v - mu
    v_projection = np.zeros(len(v)) # start to build the projection
    # project the original embedding onto the PCA basis vectors, use only first D dimensions
    for u in U:
        v_jj = np.dot(u,v) # scaler
        v_projection += v_jj*u # vector
    v_prime = v_tilde - v_projection # final embedding vector
    v_prime = v_prime/np.linalg.norm(v_prime) # create unit vector
    return v_prime